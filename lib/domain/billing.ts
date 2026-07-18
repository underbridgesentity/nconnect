import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  invoices,
  payments,
  services,
  collectionAttempts,
} from "@/lib/db/schema";
import { authorize, type Actor } from "@/lib/auth/authorize";
import { writeAudit } from "./audit";
import { emitDomainEvent, forwardDomainEvent } from "./events";
import { reactivateService } from "./services";
import { notify } from "@/lib/notify";

/**
 * Billing helpers shared by M3 (manual EFT) and the M4 engine. Payment at
 * any point clears the dunning sequence; if the service is suspended and
 * all its past-due invoices settle, reactivation runs automatically (§6.3).
 */

export async function customerBalanceCents(customerId: string): Promise<number> {
  const [row] = await db
    .select({
      due: sql<number>`coalesce(sum(${invoices.totalCents}) filter (where ${invoices.status} in ('open','past_due')), 0)::int`,
    })
    .from(invoices)
    .where(eq(invoices.customerId, customerId));
  return row.due;
}

/**
 * Record a manual EFT against an invoice (spec §6.2): audited, and triggers
 * the same payment.received flow so reactivation logic is uniform.
 */
export async function recordManualPayment(
  actor: Actor,
  input: {
    invoiceId: string;
    amountCents: number;
    reference: string;
    paidOn?: string;
  }
): Promise<void> {
  authorize(actor, "payment.record_manual");

  const outcome = await db.transaction(async (tx) => {
    const [invoice] = await tx
      .select()
      .from(invoices)
      .where(eq(invoices.id, input.invoiceId))
      .limit(1);
    if (!invoice) throw new Error("Invoice not found");
    if (invoice.status === "paid") throw new Error("Invoice is already paid");
    if (invoice.status === "void" || invoice.status === "written_off") {
      throw new Error(`Invoice is ${invoice.status}`);
    }

    await tx.insert(payments).values({
      invoiceId: invoice.id,
      method: "eft_manual",
      amountCents: input.amountCents,
      status: "complete",
      gatewayRef: input.reference || null,
      recordedBy: actor.userId,
    });

    // Fully covered? (partial payments leave the invoice open)
    const [paidSum] = await tx
      .select({
        total: sql<number>`coalesce(sum(${payments.amountCents}) filter (where ${payments.status} = 'complete'), 0)::int`,
      })
      .from(payments)
      .where(eq(payments.invoiceId, invoice.id));
    const fullyPaid = paidSum.total >= invoice.totalCents;

    if (fullyPaid) {
      await tx
        .update(invoices)
        .set({ status: "paid", paidAt: new Date() })
        .where(eq(invoices.id, invoice.id));
      // Clear any pending collection attempts (§6.3).
      await tx
        .update(collectionAttempts)
        .set({ result: "skipped", detail: "invoice settled" })
        .where(
          and(
            eq(collectionAttempts.invoiceId, invoice.id),
            sql`${collectionAttempts.executedAt} is null`
          )
        );
    }

    await writeAudit(tx, {
      actor,
      action: "payment.record_manual",
      entity: "invoice",
      entityId: invoice.id,
      after: {
        amountCents: input.amountCents,
        reference: input.reference,
        fullyPaid,
      },
    });
    const eventId = await emitDomainEvent(tx, "payment.received", {
      invoiceId: invoice.id,
      customerId: invoice.customerId,
      amountCents: input.amountCents,
      method: "eft_manual",
    });
    return { invoice, fullyPaid, eventId };
  });

  await forwardDomainEvent(outcome.eventId);

  if (outcome.fullyPaid) {
    await notify("payment_received", {
      customerId: outcome.invoice.customerId,
      amountCents: input.amountCents,
      reference: outcome.invoice.number,
    });
    await maybeReactivateAfterSettlement(outcome.invoice.customerId);
  }
}

/**
 * If a customer settles everything past due and has suspended services,
 * run the reactivation transition automatically (§5, §6.3).
 */
export async function maybeReactivateAfterSettlement(
  customerId: string
): Promise<void> {
  const [outstanding] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(invoices)
    .where(
      and(
        eq(invoices.customerId, customerId),
        inArray(invoices.status, ["open", "past_due"])
      )
    );
  if (outstanding.n > 0) return;

  const suspended = await db
    .select({ id: services.id })
    .from(services)
    .where(
      and(eq(services.customerId, customerId), eq(services.status, "suspended"))
    );
  for (const service of suspended) {
    await reactivateService(null, service.id);
  }
}
