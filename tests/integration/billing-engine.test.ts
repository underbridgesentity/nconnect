import { describe, it, expect, beforeAll } from "vitest";
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

/**
 * M4 acceptance: with a time-travel helper, drive a service through
 * issue -> failed charges -> past_due -> suspended -> paid -> reactivated
 * entirely by the engine. Runs against the dev database (DATABASE_URL) with
 * its own isolated customer/service; a mock charger controls outcomes.
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const d = describe.runIf(hasDb);

d("billing engine time-travel", () => {
  let db: typeof import("@/lib/db/client").db;
  let schema: typeof import("@/lib/db/schema");
  let engine: typeof import("@/lib/domain/billing-engine");
  let billing: typeof import("@/lib/domain/billing");
  let customerId: string;
  let serviceId: string;
  let adminActor: { userId: string; role: "admin" };

  beforeAll(async () => {
    ({ db } = await import("@/lib/db/client"));
    schema = await import("@/lib/db/schema");
    engine = await import("@/lib/domain/billing-engine");
    billing = await import("@/lib/domain/billing");

    const { eq } = await import("drizzle-orm");

    const [admin] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.role, "admin"))
      .limit(1);
    adminActor = { userId: admin.id, role: "admin" };

    // Isolated fixture: customer + active service anchored on day 10.
    const [user] = await db
      .insert(schema.users)
      .values({
        role: "customer",
        phone: `+2779${Date.now().toString().slice(-7)}`,
        name: "Billing Test",
        status: "active",
      })
      .returning({ id: schema.users.id });
    const [customer] = await db
      .insert(schema.customers)
      .values({
        userId: user.id,
        type: "individual",
        firstName: "Billing",
        lastName: "Test",
        phone: `+2778${Date.now().toString().slice(-7)}`,
        email: "billing.test@example.com",
        source: "admin",
      })
      .returning({ id: schema.customers.id });
    customerId = customer.id;

    const [plan] = await db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.slug, "telkom-lte-advanced"))
      .limit(1);

    const [service] = await db
      .insert(schema.services)
      .values({
        customerId,
        planId: plan.id,
        status: "active",
        activationDate: "2026-06-10",
        billingAnchorDay: 10,
        nextInvoiceDate: "2026-07-10",
      })
      .returning({ id: schema.services.id });
    serviceId = service.id;

    // Stored payment method so token charges are attempted.
    await db.insert(schema.paymentMethods).values({
      customerId,
      payfastToken: `test-token-${Date.now()}`,
      status: "active",
    });
  });

  const failingCharger = async () => ({
    ok: false as const,
    detail: "card declined (test)",
  });

  it("issues the anniversary invoice with the correct period", async () => {
    const { and, eq } = await import("drizzle-orm");
    await engine.runInvoiceGeneration("2026-07-10");
    const [invoice] = await db
      .select()
      .from(schema.invoices)
      .where(
        and(
          eq(schema.invoices.serviceId, serviceId),
          eq(schema.invoices.periodStart, "2026-07-10")
        )
      );
    expect(invoice).toBeTruthy();
    expect(invoice.status).toBe("open");
    expect(invoice.totalCents).toBe(75400); // Telkom LTE Advanced R754
    expect(invoice.periodEnd).toBe("2026-08-09");
    expect(invoice.dueDate).toBe("2026-07-17");

    // Idempotent: running again creates no duplicate.
    await engine.runInvoiceGeneration("2026-07-10");
    const all = await db
      .select()
      .from(schema.invoices)
      .where(
        and(
          eq(schema.invoices.serviceId, serviceId),
          eq(schema.invoices.periodStart, "2026-07-10")
        )
      );
    expect(all.length).toBe(1);

    // next_invoice_date advanced one month on the anchor.
    const [svc] = await db
      .select()
      .from(schema.services)
      .where(eq(schema.services.id, serviceId));
    expect(svc.nextInvoiceDate).toBe("2026-08-10");
  });

  it("attempts and records failing charges on days 0/2/5", async () => {
    const { eq } = await import("drizzle-orm");
    await engine.runDunning("2026-07-10", { charger: failingCharger });
    await engine.runDunning("2026-07-12", { charger: failingCharger });
    await engine.runDunning("2026-07-15", { charger: failingCharger });
    // Re-running a day is idempotent per attempt slot.
    await engine.runDunning("2026-07-15", { charger: failingCharger });

    const [invoice] = await db
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.serviceId, serviceId));
    const attempts = await db
      .select()
      .from(schema.collectionAttempts)
      .where(eq(schema.collectionAttempts.invoiceId, invoice.id));
    expect(attempts.length).toBe(3);
    expect(attempts.every((a) => a.result === "failed")).toBe(true);
  });

  it("marks past_due on day 7", async () => {
    const { eq } = await import("drizzle-orm");
    await engine.runDunning("2026-07-17", { charger: failingCharger });
    const [invoice] = await db
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.serviceId, serviceId));
    expect(invoice.status).toBe("past_due");
  });

  it("suspends the service on day 10 through the state machine", async () => {
    const { eq } = await import("drizzle-orm");
    await engine.runDunning("2026-07-20", { charger: failingCharger });
    const [svc] = await db
      .select()
      .from(schema.services)
      .where(eq(schema.services.id, serviceId));
    expect(svc.status).toBe("suspended");
    // The connector created a suspend task.
    const tasks = await db
      .select()
      .from(schema.provisioningTasks)
      .where(eq(schema.provisioningTasks.serviceId, serviceId));
    expect(tasks.some((t) => t.type === "suspend")).toBe(true);
  });

  it("payment settles the invoice and auto-reactivates the service", async () => {
    const { eq } = await import("drizzle-orm");
    const [invoice] = await db
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.serviceId, serviceId));

    await billing.recordManualPayment(
      adminActor,
      {
        invoiceId: invoice.id,
        amountCents: invoice.totalCents,
        reference: `EFT-TEST-${Date.now()}`,
      }
    );

    const [paid] = await db
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.id, invoice.id));
    expect(paid.status).toBe("paid");

    const [svc] = await db
      .select()
      .from(schema.services)
      .where(eq(schema.services.id, serviceId));
    expect(svc.status).toBe("active");
    expect(svc.suspendedAt).toBeNull();

    const tasks = await db
      .select()
      .from(schema.provisioningTasks)
      .where(eq(schema.provisioningTasks.serviceId, serviceId));
    expect(tasks.some((t) => t.type === "reactivate")).toBe(true);
  });

  it("successful token charge pays the next invoice immediately", async () => {
    const { and, eq } = await import("drizzle-orm");
    await engine.runInvoiceGeneration("2026-08-10");
    const okCharger = async () => ({
      ok: true as const,
      gatewayRef: `PF-TEST-${Date.now()}`,
    });
    await engine.runDunning("2026-08-10", { charger: okCharger });
    const [invoice] = await db
      .select()
      .from(schema.invoices)
      .where(
        and(
          eq(schema.invoices.serviceId, serviceId),
          eq(schema.invoices.periodStart, "2026-08-10")
        )
      );
    expect(invoice.status).toBe("paid");
  });

  it("upgrade issues an integer-exact adjustment invoice and swaps the plan", async () => {
    const { and, eq } = await import("drizzle-orm");
    // Upgrade Advanced (R754) -> Plus? Plus is cheaper; use Starter->? Within
    // telkom_lte: advanced R754 is top; switch service to Starter first via
    // fixture would complicate, instead upgrade from Advanced to Advanced is
    // invalid, so seed the service back to Starter for the test.
    await db
      .update(schema.services)
      .set({ planId: (await db.select().from(schema.plans).where(eq(schema.plans.slug, "telkom-lte-starter")))[0].id })
      .where(eq(schema.services.id, serviceId));

    const [advanced] = await db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.slug, "telkom-lte-advanced"));

    const result = await engine.changePlan(adminActor, serviceId, advanced.id, {
      today: "2026-08-20",
      charger: failingCharger,
    });
    expect(result.kind).toBe("upgrade");
    if (result.kind !== "upgrade") return;

    const lines = await db
      .select()
      .from(schema.invoiceLines)
      .where(eq(schema.invoiceLines.invoiceId, result.invoiceId));
    const credit = lines.find((l) => l.kind === "prorata_credit")!;
    const charge = lines.find((l) => l.kind === "prorata_charge")!;
    // Period 2026-08-10 -> 2026-09-10 (31 days), 10 days used.
    expect(credit.amountCents).toBe(-(33100 - Math.trunc((33100 * 10) / 31)));
    expect(charge.amountCents).toBe(75400 - Math.trunc((75400 * 10) / 31));
    expect(result.netCents).toBe(credit.amountCents + charge.amountCents);

    const [svc] = await db
      .select()
      .from(schema.services)
      .where(eq(schema.services.id, serviceId));
    expect(svc.planId).toBe(advanced.id);

    // change_plan task created for staff.
    const tasks = await db
      .select()
      .from(schema.provisioningTasks)
      .where(
        and(
          eq(schema.provisioningTasks.serviceId, serviceId),
          eq(schema.provisioningTasks.type, "change_plan")
        )
      );
    expect(tasks.length).toBeGreaterThan(0);
  });

  it("downgrade schedules at the next anchor and rolls over in the billing run", async () => {
    const { and, eq } = await import("drizzle-orm");
    const [starter] = await db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.slug, "telkom-lte-starter"));

    const result = await engine.changePlan(
      adminActor,
      serviceId,
      starter.id,
      { today: "2026-08-25" }
    );
    expect(result.kind).toBe("downgrade");
    if (result.kind !== "downgrade") return;
    expect(result.effectiveDate).toBe("2026-09-10");

    // Rollover happens in the next invoice generation.
    await engine.runInvoiceGeneration("2026-09-10");
    const [svc] = await db
      .select()
      .from(schema.services)
      .where(eq(schema.services.id, serviceId));
    expect(svc.planId).toBe(starter.id);
    expect(svc.pendingPlanId).toBeNull();

    const [rolloverInvoice] = await db
      .select()
      .from(schema.invoices)
      .where(
        and(
          eq(schema.invoices.serviceId, serviceId),
          eq(schema.invoices.periodStart, "2026-09-10")
        )
      );
    expect(rolloverInvoice.totalCents).toBe(33100); // billed at the new plan
  });
});
