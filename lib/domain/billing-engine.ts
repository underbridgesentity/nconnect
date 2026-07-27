import "server-only";
import { and, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { createHmac } from "node:crypto";
import { db } from "@/lib/db/client";
import {
  services,
  plans,
  invoices,
  invoiceLines,
  payments,
  paymentMethods,
  collectionAttempts,
  customers,
  users,
  notifications,
} from "@/lib/db/schema";
import { add, formatCents, prorataComplement, type Cents } from "@/lib/money";
import { authorize, type Actor } from "@/lib/auth/authorize";
import { writeAudit } from "./audit";
import { emitDomainEvent, forwardDomainEvent } from "./events";
import { nextNumber } from "./sequences";
import { getSettingOr } from "./settings";
import {
  suspendService,
  finalizeCancellation,
  nextMonthOnAnchor,
  todayInJohannesburg,
} from "./services";
import {
  maybeReactivateAfterSettlement,
  outstandingCents,
  paidCentsFor,
  paidCentsForInvoice,
} from "./billing";
import { getConnector } from "@/lib/connectors";
import { chargeToken } from "@/lib/payfast";
import { notify } from "@/lib/notify";
import { renderInvoicePdf } from "@/lib/pdf/invoice";
import { appUrl } from "@/lib/config";

/**
 * The billing engine (spec §6). Anniversary billing on each service's
 * anchor day; dunning per the settings timeline; token charges; automatic
 * suspend/reactivate through the state machine. All date parameters are
 * explicit so tests can time-travel; the crons pass "today" in
 * Africa/Johannesburg.
 */

export interface DunningConfig {
  chargeAttemptDays: number[];
  pastDueDay: number;
  suspendDay: number;
  adminDecisionDay: number;
  invoiceDueDays: number;
}

export const DEFAULT_DUNNING: DunningConfig = {
  chargeAttemptDays: [0, 2, 5],
  pastDueDay: 7,
  suspendDay: 10,
  adminDecisionDay: 40,
  invoiceDueDays: 7,
};

export type Charger = (req: {
  token: string;
  amountCents: number;
  itemName: string;
  paymentId: string;
}) => Promise<{ ok: boolean; gatewayRef?: string; detail?: string }>;

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round(
    (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000
  );
}

// ------------------------------------------------------- invoice generation

/**
 * Generate recurring invoices for every active/suspended service whose
 * next_invoice_date <= today (§6.1). Idempotent: a service+period pair is
 * only ever invoiced once. Returns created invoice ids.
 */
export async function runInvoiceGeneration(
  today = todayInJohannesburg()
): Promise<string[]> {
  const dunning = await getSettingOr<DunningConfig>("dunning", DEFAULT_DUNNING);

  const due = await db
    .select({ service: services, plan: plans })
    .from(services)
    .innerJoin(plans, eq(services.planId, plans.id))
    .where(
      and(
        inArray(services.status, ["active", "suspended"]),
        lte(services.nextInvoiceDate, today)
      )
    );

  const created: string[] = [];
  for (const { service, plan } of due) {
    const periodStart = service.nextInvoiceDate!;
    const periodEnd = addDays(
      nextMonthOnAnchor(periodStart, service.billingAnchorDay ?? 1),
      -1
    );

    const invoiceId = await db.transaction(async (tx) => {
      // Idempotency: one invoice per service+period.
      const [existing] = await tx
        .select({ id: invoices.id })
        .from(invoices)
        .where(
          and(
            eq(invoices.serviceId, service.id),
            eq(invoices.periodStart, periodStart)
          )
        )
        .limit(1);
      if (existing) {
        // Advance the pointer anyway so we don't loop forever.
        await tx
          .update(services)
          .set({
            nextInvoiceDate: nextMonthOnAnchor(
              periodStart,
              service.billingAnchorDay ?? 1
            ),
          })
          .where(eq(services.id, service.id));
        return null;
      }

      // Scheduled downgrade rollover (§5): swap at the anchor.
      let billingPlan = plan;
      if (
        service.pendingPlanId &&
        service.planChangeEffectiveDate &&
        service.planChangeEffectiveDate <= periodStart
      ) {
        const [newPlan] = await tx
          .select()
          .from(plans)
          .where(eq(plans.id, service.pendingPlanId))
          .limit(1);
        if (newPlan) {
          billingPlan = newPlan;
          await tx
            .update(services)
            .set({
              planId: newPlan.id,
              pendingPlanId: null,
              planChangeEffectiveDate: null,
            })
            .where(eq(services.id, service.id));
          await writeAudit(tx, {
            actor: null,
            action: "service.plan_change.rollover",
            entity: "service",
            entityId: service.id,
            before: { planId: plan.id },
            after: { planId: newPlan.id },
          });
        }
      }

      const number = await nextNumber(tx, "INV");
      const [invoice] = await tx
        .insert(invoices)
        .values({
          number,
          customerId: service.customerId,
          serviceId: service.id,
          periodStart,
          periodEnd,
          issueDate: today,
          dueDate: addDays(today, dunning.invoiceDueDays),
          status: "open",
          subtotalCents: billingPlan.priceCents,
          totalCents: billingPlan.priceCents,
        })
        .returning({ id: invoices.id, number: invoices.number });

      await tx.insert(invoiceLines).values({
        invoiceId: invoice.id,
        kind: "subscription",
        description: `${billingPlan.name}, ${periodStart} to ${periodEnd}`,
        serviceId: service.id,
        amountCents: billingPlan.priceCents,
      });

      await tx
        .update(services)
        .set({
          nextInvoiceDate: nextMonthOnAnchor(
            periodStart,
            service.billingAnchorDay ?? 1
          ),
        })
        .where(eq(services.id, service.id));

      await writeAudit(tx, {
        actor: null,
        action: "invoice.issue",
        entity: "invoice",
        entityId: invoice.id,
        after: {
          number: invoice.number,
          serviceId: service.id,
          amountCents: billingPlan.priceCents,
          periodStart,
          periodEnd,
        },
      });
      await emitDomainEvent(tx, "invoice.issued", {
        invoiceId: invoice.id,
        customerId: service.customerId,
      });
      return invoice.id;
    });

    if (invoiceId) {
      created.push(invoiceId);
      await notifyInvoiceIssued(invoiceId);
    }
  }
  return created;
}

async function notifyInvoiceIssued(invoiceId: string): Promise<void> {
  const [invoice] = await db
    .select()
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  if (!invoice) return;
  let pdf: Buffer | undefined;
  try {
    pdf = await renderInvoicePdf(invoiceId);
  } catch (err) {
    console.error("invoice pdf failed:", err);
  }
  await notify("invoice_issued", {
    customerId: invoice.customerId,
    amountCents: invoice.totalCents,
    reference: invoice.number,
    link: payLinkFor(invoiceId),
    attachments: pdf
      ? [{ filename: `${invoice.number}.pdf`, content: pdf }]
      : undefined,
  });
}

// ------------------------------------------------------------- pay links

export function payLinkToken(invoiceId: string): string {
  const secret = process.env.AUTH_SECRET ?? "dev-secret";
  return createHmac("sha256", secret)
    .update(`paylink:${invoiceId}`)
    .digest("hex")
    .slice(0, 32);
}

export function payLinkFor(invoiceId: string): string {
  const base = appUrl();
  return `${base}/pay/${invoiceId}?t=${payLinkToken(invoiceId)}`;
}

export function verifyPayLinkToken(invoiceId: string, token: string): boolean {
  return payLinkToken(invoiceId) === token;
}

// ------------------------------------------------- gateway invoice payment

/**
 * Pure settlement rule for one gateway payment, kept separate from the
 * database so it can be reasoned about and tested on its own.
 *
 * Money that arrives for less than the full invoice is still money: it is
 * banked and the invoice stays open for the rest. Only money that arrives for
 * more than is owed is refused, because financial rows are never deleted
 * (§16.4) and an over-allocation would be permanent.
 */
export function gatewayPaymentOutcome(input: {
  totalCents: Cents;
  alreadyPaidCents: Cents;
  amountCents: Cents;
}):
  | {
      accepted: true;
      outstandingCents: Cents;
      paidTotalCents: Cents;
      settles: boolean;
    }
  | { accepted: false; reason: string } {
  const outstanding = outstandingCents(input.totalCents, input.alreadyPaidCents);
  if (input.amountCents <= 0) {
    return { accepted: false, reason: "Payment amount must be more than R0.00" };
  }
  if (outstanding === 0) {
    return {
      accepted: false,
      reason: "Nothing is outstanding on this invoice, so the payment was not banked",
    };
  }
  if (input.amountCents > outstanding) {
    return {
      accepted: false,
      reason:
        `Payment of ${formatCents(input.amountCents)} exceeds the ` +
        `${formatCents(outstanding)} outstanding on this invoice`,
    };
  }
  const paidTotalCents = add(input.alreadyPaidCents, input.amountCents);
  return {
    accepted: true,
    outstandingCents: outstanding,
    paidTotalCents,
    settles: paidTotalCents >= input.totalCents,
  };
}

/**
 * Bank a gateway payment against an invoice (ITN pay-link or token charge).
 * Idempotent on the gateway ref; clears dunning and auto-reactivates once the
 * invoice is settled.
 *
 * The amount does not have to equal the invoice total. A customer paying the
 * outstanding balance of a part-paid invoice, or paying what they can afford,
 * must have that money recorded rather than met with an error after the card
 * has already been debited.
 */
export async function markInvoicePaidFromGateway(input: {
  invoiceId: string;
  gatewayRef: string;
  amountCents: number;
  method: "payfast_card" | "payfast_token";
}): Promise<{
  ok: boolean;
  alreadyPaid: boolean;
  settled: boolean;
  paidCents: Cents;
  outstandingCents: Cents;
}> {
  const eventIds: string[] = [];
  const outcome = await db.transaction(async (tx) => {
    // Row lock: an ITN and a token charge landing together must not both read
    // the same balance and both bank a payment against it.
    const [invoice] = await tx
      .select()
      .from(invoices)
      .where(eq(invoices.id, input.invoiceId))
      .limit(1)
      .for("update");
    if (!invoice) throw new Error("Invoice not found");

    const alreadyPaidCents = await paidCentsFor(tx, invoice.id);

    if (invoice.status === "paid") {
      return {
        invoice,
        alreadyPaid: true,
        settled: true,
        paidCents: alreadyPaidCents,
      };
    }
    if (invoice.status === "void" || invoice.status === "written_off") {
      throw new Error(
        `Invoice ${invoice.number} is ${invoice.status.replace(
          "_",
          " "
        )}, so this payment needs a person to allocate it`
      );
    }

    // The gateway ref is the idempotency key: a replayed ITN or a retried
    // token charge must never bank the same money twice.
    const [duplicate] = await tx
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.gatewayRef, input.gatewayRef))
      .limit(1);
    if (duplicate) {
      return {
        invoice,
        alreadyPaid: true,
        settled: alreadyPaidCents >= invoice.totalCents,
        paidCents: alreadyPaidCents,
      };
    }

    const decision = gatewayPaymentOutcome({
      totalCents: invoice.totalCents,
      alreadyPaidCents,
      amountCents: input.amountCents,
    });
    if (!decision.accepted) throw new Error(decision.reason);

    await tx.insert(payments).values({
      invoiceId: invoice.id,
      method: input.method,
      amountCents: input.amountCents,
      status: "complete",
      gatewayRef: input.gatewayRef,
    });

    if (decision.settles) {
      await tx
        .update(invoices)
        .set({ status: "paid", paidAt: new Date() })
        .where(eq(invoices.id, invoice.id));
      await tx
        .update(collectionAttempts)
        .set({ result: "skipped", detail: "invoice settled" })
        .where(
          and(
            eq(collectionAttempts.invoiceId, invoice.id),
            isNull(collectionAttempts.executedAt)
          )
        );
    }

    await writeAudit(tx, {
      actor: null,
      action: decision.settles ? "invoice.paid" : "invoice.part_paid",
      entity: "invoice",
      entityId: invoice.id,
      before: { status: invoice.status, paidCents: alreadyPaidCents },
      after: {
        status: decision.settles ? "paid" : invoice.status,
        method: input.method,
        gatewayRef: input.gatewayRef,
        amountCents: input.amountCents,
        paidCents: decision.paidTotalCents,
        outstandingCents: outstandingCents(
          invoice.totalCents,
          decision.paidTotalCents
        ),
      },
    });
    eventIds.push(
      await emitDomainEvent(tx, "payment.received", {
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        amountCents: input.amountCents,
        method: input.method,
        settled: decision.settles,
      })
    );
    return {
      invoice,
      alreadyPaid: false,
      settled: decision.settles,
      paidCents: decision.paidTotalCents,
    };
  });

  for (const id of eventIds) await forwardDomainEvent(id);

  if (!outcome.alreadyPaid) {
    await notify("payment_received", {
      customerId: outcome.invoice.customerId,
      amountCents: input.amountCents,
      reference: outcome.invoice.number,
    });
    if (outcome.settled) {
      await maybeReactivateAfterSettlement(outcome.invoice.customerId);
    }
  }
  return {
    ok: true,
    alreadyPaid: outcome.alreadyPaid,
    settled: outcome.settled,
    paidCents: outcome.paidCents,
    outstandingCents: outstandingCents(
      outcome.invoice.totalCents,
      outcome.paidCents
    ),
  };
}

// ----------------------------------------------------------- token charges

/** Attempt a token charge for an open invoice (§6.2/§6.3). */
export async function attemptTokenCharge(
  invoiceId: string,
  attemptNo: number,
  opts: { charger?: Charger; today?: string } = {}
): Promise<{ result: "success" | "failed" | "skipped"; detail?: string }> {
  const charger = opts.charger ?? chargeToken;

  const [invoice] = await db
    .select()
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  if (
    !invoice ||
    invoice.status === "paid" ||
    invoice.status === "void" ||
    invoice.status === "written_off"
  ) {
    return { result: "skipped", detail: "invoice not chargeable" };
  }
  // Charge what is still owed, not the invoice total: an invoice that has been
  // part-paid by EFT would otherwise be debited for the whole amount again.
  const dueCents = outstandingCents(
    invoice.totalCents,
    await paidCentsForInvoice(invoice.id)
  );
  if (dueCents === 0) {
    return { result: "skipped", detail: "nothing outstanding" };
  }
  const [method] = await db
    .select()
    .from(paymentMethods)
    .where(
      and(
        eq(paymentMethods.customerId, invoice.customerId),
        eq(paymentMethods.status, "active")
      )
    )
    .limit(1);
  if (!method) return { result: "skipped", detail: "no stored payment method" };

  const attemptId = await db.transaction(async (tx) => {
    const [attempt] = await tx
      .insert(collectionAttempts)
      .values({
        invoiceId,
        attemptNo,
        scheduledFor: new Date(),
        executedAt: new Date(),
      })
      .returning({ id: collectionAttempts.id });
    return attempt.id;
  });

  const charge = await charger({
    token: method.payfastToken,
    amountCents: dueCents,
    itemName: `Needd Connect invoice ${invoice.number}`,
    paymentId: `inv:${invoice.id}:${attemptNo}`,
  });

  if (charge.ok && charge.gatewayRef) {
    await db
      .update(collectionAttempts)
      .set({ result: "success", detail: charge.gatewayRef })
      .where(eq(collectionAttempts.id, attemptId));
    await markInvoicePaidFromGateway({
      invoiceId,
      gatewayRef: charge.gatewayRef,
      amountCents: dueCents,
      method: "payfast_token",
    });
    return { result: "success" };
  }

  await db
    .update(collectionAttempts)
    .set({ result: "failed", detail: charge.detail ?? "charge failed" })
    .where(eq(collectionAttempts.id, attemptId));
  await notify("payment_failed", {
    customerId: invoice.customerId,
    amountCents: dueCents,
    reference: invoice.number,
    link: payLinkFor(invoiceId),
  });
  return { result: "failed", detail: charge.detail };
}

// ---------------------------------------------------------------- dunning

/**
 * Daily dunning sweep (§6.3). Timeline relative to invoice issue date:
 * day 0 charge #1, +2 charge #2, +5 charge #3, +7 past_due warning,
 * +10 suspend, +40 admin decision. Explicit `today` for time-travel tests.
 */
export async function runDunning(
  today = todayInJohannesburg(),
  opts: { charger?: Charger } = {}
): Promise<{ processed: number }> {
  const dunning = await getSettingOr<DunningConfig>("dunning", DEFAULT_DUNNING);
  const open = await db
    .select()
    .from(invoices)
    .where(inArray(invoices.status, ["open", "past_due"]));

  let processed = 0;
  for (const invoice of open) {
    const age = daysBetween(invoice.issueDate, today);
    if (age < 0) continue;
    processed++;

    // Token charge attempts on the configured days (only once per day-slot).
    const attemptIndex = dunning.chargeAttemptDays.indexOf(age);
    if (attemptIndex >= 0) {
      const [already] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(collectionAttempts)
        .where(
          and(
            eq(collectionAttempts.invoiceId, invoice.id),
            eq(collectionAttempts.attemptNo, attemptIndex + 1)
          )
        );
      if (already.n === 0) {
        await attemptTokenCharge(invoice.id, attemptIndex + 1, {
          charger: opts.charger,
          today,
        });
      }
    }

    // Re-read (a charge may have settled it).
    const [current] = await db
      .select()
      .from(invoices)
      .where(eq(invoices.id, invoice.id))
      .limit(1);
    if (!current || current.status === "paid") continue;

    // past_due at +pastDueDay with the 3-day warning (§6.3).
    if (age >= dunning.pastDueDay && current.status === "open") {
      // What we tell the customer they owe is the balance, not the total: a
      // part payment leaves the invoice open on purpose (§6.2).
      const dueCents = outstandingCents(
        current.totalCents,
        await paidCentsForInvoice(current.id)
      );
      await db.transaction(async (tx) => {
        await tx
          .update(invoices)
          .set({ status: "past_due" })
          .where(eq(invoices.id, invoice.id));
        await writeAudit(tx, {
          actor: null,
          action: "invoice.past_due",
          entity: "invoice",
          entityId: invoice.id,
          after: { age },
        });
      });
      await notify("past_due_warning", {
        customerId: current.customerId,
        amountCents: dueCents,
        reference: current.number,
        link: payLinkFor(invoice.id),
      });
    }

    // Suspend at +suspendDay (state machine handles task + notification).
    if (age >= dunning.suspendDay && current.serviceId) {
      const [service] = await db
        .select()
        .from(services)
        .where(eq(services.id, current.serviceId))
        .limit(1);
      if (service?.status === "active") {
        await suspendService(
          null,
          service.id,
          `Invoice ${current.number} unpaid ${age} days`
        );
        const [plan] = await db
          .select()
          .from(plans)
          .where(eq(plans.id, service.planId))
          .limit(1);
        await notify("service_suspended", {
          customerId: current.customerId,
          serviceName: plan?.name ?? "service",
          reference: current.number,
          link: payLinkFor(invoice.id),
        });
      }
    }

    // +adminDecisionDay: unpaid and suspended, human decision, nothing
    // automatic (§6.3). One bell per invoice.
    if (age >= dunning.adminDecisionDay) {
      const marker = `dunning_decision:${invoice.id}`;
      const [existing] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(notifications)
        .where(eq(notifications.type, marker));
      if (existing.n === 0) {
        const admins = await db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.role, "admin"), eq(users.status, "active")));
        const [customer] = await db
          .select()
          .from(customers)
          .where(eq(customers.id, current.customerId))
          .limit(1);
        const name =
          customer?.companyName ??
          [customer?.firstName, customer?.lastName].filter(Boolean).join(" ");
        if (admins.length) {
          await db.insert(notifications).values(
            admins.map((a) => ({
              userId: a.id,
              type: marker,
              title: `Decision needed: ${name}, ${current.number} unpaid ${age} days`,
              body: "Suspended for 30 days. Cancel the service or write off the invoice; nothing happens automatically.",
              link: `/admin/customers/${current.customerId}?tab=billing`,
            }))
          );
        }
      }
    }
  }
  return { processed };
}

// ------------------------------------------------------- lifecycle sweeps

/** Finalize cancellations whose effective date has arrived (§5). */
export async function runCancellationSweep(
  today = todayInJohannesburg()
): Promise<number> {
  const due = await db
    .select({ id: services.id })
    .from(services)
    .where(
      and(
        eq(services.status, "pending_cancellation"),
        lte(services.cancelEffectiveDate, today)
      )
    );
  for (const service of due) {
    await finalizeCancellation(service.id);
  }
  return due.length;
}

// -------------------------------------------------------------- plan change

export interface ProrataAdjustment {
  creditCents: number; // negative line for unused days of the old plan
  chargeCents: number; // positive line for remaining days of the new plan
  netCents: number;
  daysUsed: number;
  daysRemaining: number;
  daysInPeriod: number;
}

/**
 * Pure §5 upgrade maths, unit-tested independently: daily rate = monthly
 * price / days in the current period, integer-exact with the remainder on
 * the charge side.
 */
export function computeUpgradeAdjustment(
  oldPriceCents: number,
  newPriceCents: number,
  periodStart: string,
  periodEndExclusive: string,
  today: string
): ProrataAdjustment {
  const daysInPeriod = daysBetween(periodStart, periodEndExclusive);
  const daysUsed = Math.min(Math.max(daysBetween(periodStart, today), 0), daysInPeriod);
  const daysRemaining = daysInPeriod - daysUsed;
  // Credit the unused complement of the old plan (exact), charge the same
  // remaining days at the new rate.
  const creditCents = -prorataComplement(oldPriceCents, daysUsed, daysInPeriod);
  const chargeCents = prorataComplement(newPriceCents, daysUsed, daysInPeriod);
  return {
    creditCents,
    chargeCents,
    netCents: add(creditCents, chargeCents),
    daysUsed,
    daysRemaining,
    daysInPeriod,
  };
}

/**
 * Plan change on an active service (§5): upgrade immediate with an
 * adjustment invoice; downgrade scheduled at the next anchor.
 */
export async function changePlan(
  actor: Actor,
  serviceId: string,
  newPlanId: string,
  opts: { today?: string; charger?: Charger } = {}
): Promise<
  | { kind: "upgrade"; invoiceId: string; netCents: number; charged: boolean }
  | { kind: "downgrade"; effectiveDate: string }
> {
  const today = opts.today ?? todayInJohannesburg();

  const scope = await db
    .select({ customerId: services.customerId })
    .from(services)
    .where(eq(services.id, serviceId))
    .limit(1);
  authorize(actor, "service.transition", { customerId: scope[0]?.customerId });

  const prep = await db.transaction(async (tx) => {
    const [service] = await tx
      .select()
      .from(services)
      .where(eq(services.id, serviceId))
      .limit(1);
    if (!service) throw new Error("Service not found");
    if (service.status !== "active") {
      throw new Error("Plan changes need an active service");
    }
    const [oldPlan] = await tx
      .select()
      .from(plans)
      .where(eq(plans.id, service.planId))
      .limit(1);
    const [newPlan] = await tx
      .select()
      .from(plans)
      .where(and(eq(plans.id, newPlanId), eq(plans.status, "published")))
      .limit(1);
    if (!newPlan) throw new Error("That plan is not available");
    if (newPlan.id === oldPlan.id) throw new Error("Already on that plan");
    if (newPlan.category !== oldPlan.category) {
      throw new Error(
        "Plan changes stay within the same category, start a new signup for a different product"
      );
    }
    return { service, oldPlan, newPlan };
  });

  const { service, oldPlan, newPlan } = prep;
  const isUpgrade = newPlan.priceCents >= oldPlan.priceCents;

  if (!isUpgrade) {
    // Downgrade: swap at the next anchor; provisioning task at rollover
    // happens in the billing run. No adjustment invoice (§5).
    const effectiveDate = service.nextInvoiceDate ?? today;
    await db.transaction(async (tx) => {
      await tx
        .update(services)
        .set({
          pendingPlanId: newPlan.id,
          planChangeEffectiveDate: effectiveDate,
        })
        .where(eq(services.id, serviceId));
      await writeAudit(tx, {
        actor,
        action: "service.plan_change.schedule",
        entity: "service",
        entityId: serviceId,
        after: { newPlanId: newPlan.id, effectiveDate, kind: "downgrade" },
      });
    });
    return { kind: "downgrade", effectiveDate };
  }

  // Upgrade: immediate. Period = last anchor to next anchor.
  const periodEnd = service.nextInvoiceDate ?? nextMonthOnAnchor(today, service.billingAnchorDay ?? 1);
  const periodStart = service.activationDate && daysBetween(service.activationDate, today) < 31
    ? service.activationDate
    : addDaysToAnchor(periodEnd, service.billingAnchorDay ?? 1);
  const adjustment = computeUpgradeAdjustment(
    oldPlan.priceCents,
    newPlan.priceCents,
    periodStart,
    periodEnd,
    today
  );

  const dunning = await getSettingOr<DunningConfig>("dunning", DEFAULT_DUNNING);
  const invoiceId = await db.transaction(async (tx) => {
    const number = await nextNumber(tx, "INV");
    const [invoice] = await tx
      .insert(invoices)
      .values({
        number,
        customerId: service.customerId,
        serviceId,
        issueDate: today,
        dueDate: addDays(today, dunning.invoiceDueDays),
        status: "open",
        subtotalCents: adjustment.netCents,
        totalCents: adjustment.netCents,
      })
      .returning({ id: invoices.id });
    await tx.insert(invoiceLines).values([
      {
        invoiceId: invoice.id,
        kind: "prorata_credit",
        description: `${oldPlan.name}, credit for ${adjustment.daysRemaining} unused days`,
        serviceId,
        amountCents: adjustment.creditCents,
      },
      {
        invoiceId: invoice.id,
        kind: "prorata_charge",
        description: `${newPlan.name}, ${adjustment.daysRemaining} days to ${periodEnd}`,
        serviceId,
        amountCents: adjustment.chargeCents,
      },
    ]);

    // Upgrade takes effect immediately (§5).
    await tx
      .update(services)
      .set({ planId: newPlan.id, pendingPlanId: null, planChangeEffectiveDate: null })
      .where(eq(services.id, serviceId));
    await writeAudit(tx, {
      actor,
      action: "service.plan_change.upgrade",
      entity: "service",
      entityId: serviceId,
      before: { planId: oldPlan.id },
      after: {
        planId: newPlan.id,
        adjustmentInvoice: number,
        netCents: adjustment.netCents,
      },
    });
    await emitDomainEvent(tx, "invoice.issued", {
      invoiceId: invoice.id,
      customerId: service.customerId,
      kind: "plan_change",
    });
    return invoice.id;
  });

  // change_plan provisioning task for staff (§5).
  const [provider] = await db
    .select({ name: sql<string>`p.name` })
    .from(sql`${plans} as pl`)
    .innerJoin(sql`providers p`, sql`pl.provider_id = p.id`)
    .where(sql`pl.id = ${newPlan.id}`);
  await getConnector(provider?.name).changePlan(
    {
      serviceId,
      customerId: service.customerId,
      planId: newPlan.id,
      planName: newPlan.name,
      category: newPlan.category,
      providerName: provider?.name ?? "provider",
    },
    { planId: newPlan.id, planName: newPlan.name }
  );

  // Charge the stored token if present, otherwise the pay link goes out.
  let charged = false;
  if (adjustment.netCents > 0) {
    const attempt = await attemptTokenCharge(invoiceId, 1, {
      charger: opts.charger,
      today,
    });
    charged = attempt.result === "success";
    if (!charged) {
      await notifyInvoiceIssued(invoiceId);
    }
  } else {
    // Net zero or credit, nothing to collect.
    await db
      .update(invoices)
      .set({ status: "paid", paidAt: new Date() })
      .where(and(eq(invoices.id, invoiceId), lte(invoices.totalCents, 0)));
  }

  return {
    kind: "upgrade",
    invoiceId,
    netCents: adjustment.netCents,
    charged,
  };
}

/** Previous anchor date for a given next-anchor date. */
function addDaysToAnchor(nextAnchor: string, anchorDay: number): string {
  const [y, m] = nextAnchor.split("-").map(Number);
  const prevMonth = m === 1 ? 12 : m - 1;
  const prevYear = m === 1 ? y - 1 : y;
  return `${prevYear}-${String(prevMonth).padStart(2, "0")}-${String(
    Math.min(anchorDay, 28)
  ).padStart(2, "0")}`;
}

// ------------------------------------------------------------- age analysis

export interface AgeBucket {
  customerId: string;
  customerName: string;
  currentCents: number;
  d30Cents: number;
  d60Cents: number;
  d90Cents: number;
  totalCents: number;
}

export async function ageAnalysis(
  today = todayInJohannesburg()
): Promise<AgeBucket[]> {
  const rows = await db
    .select({ invoice: invoices, customer: customers })
    .from(invoices)
    .innerJoin(customers, eq(invoices.customerId, customers.id))
    .where(inArray(invoices.status, ["open", "past_due"]));

  const map = new Map<string, AgeBucket>();
  for (const { invoice, customer } of rows) {
    const name =
      customer.companyName ??
      [customer.firstName, customer.lastName].filter(Boolean).join(" ");
    const bucket =
      map.get(customer.id) ??
      ({
        customerId: customer.id,
        customerName: name,
        currentCents: 0,
        d30Cents: 0,
        d60Cents: 0,
        d90Cents: 0,
        totalCents: 0,
      } satisfies AgeBucket);
    const age = daysBetween(invoice.issueDate, today);
    if (age < 30) bucket.currentCents += invoice.totalCents;
    else if (age < 60) bucket.d30Cents += invoice.totalCents;
    else if (age < 90) bucket.d60Cents += invoice.totalCents;
    else bucket.d90Cents += invoice.totalCents;
    bucket.totalCents += invoice.totalCents;
    map.set(customer.id, bucket);
  }
  return [...map.values()].sort((a, b) => b.totalCents - a.totalCents);
}
