import "server-only";
import { and, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { createHmac } from "node:crypto";
import { z } from "zod";
import { db, type Tx } from "@/lib/db/client";
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
  auditLog,
} from "@/lib/db/schema";
import {
  add,
  formatCents,
  prorataComplement,
  subtract,
  type Cents,
} from "@/lib/money";
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
  paidCentsByInvoice,
  paidCentsFor,
  paidCentsForInvoice,
} from "./billing";
import { getConnector } from "@/lib/connectors";
import {
  chargeToken,
  derivedGatewayRef,
  isDerivedGatewayRef,
} from "@/lib/payfast";
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
 * next_invoice_date <= today (§6.1). Returns created invoice ids.
 *
 * Idempotent, and safe when two runs overlap. Each service row is taken with
 * `select ... for update` before anything is read from it, and the billing
 * pointer is re-read under that lock: a run that arrives second finds
 * `next_invoice_date` already advanced past today and does nothing. Without
 * the lock, two runs could both read the same anchor date, both find no
 * invoice for the period, and bill the customer for the month twice.
 *
 * One bad service never stops the rest: each is its own transaction and its
 * own try/catch, so a run that hits a broken row still bills every customer
 * after it.
 */
export async function runInvoiceGeneration(
  today = todayInJohannesburg()
): Promise<string[]> {
  const dunning = await getSettingOr<DunningConfig>("dunning", DEFAULT_DUNNING);

  const due = await db
    .select({ id: services.id })
    .from(services)
    .innerJoin(plans, eq(services.planId, plans.id))
    .where(
      and(
        inArray(services.status, ["active", "suspended"]),
        lte(services.nextInvoiceDate, today)
      )
    );

  const created: string[] = [];
  let failed = 0;
  for (const row of due) {
    let invoiceId: string | null = null;
    try {
      invoiceId = await db.transaction(async (tx) => {
        // Row lock first, then every decision is made from the locked row.
        const [service] = await tx
          .select()
          .from(services)
          .where(eq(services.id, row.id))
          .limit(1)
          .for("update");
        if (!service) return null;
        if (service.status !== "active" && service.status !== "suspended") {
          return null;
        }

        // Re-read under the lock: an overlapping run may already have billed
        // this period and moved the pointer on.
        const periodStart = service.nextInvoiceDate;
        if (!periodStart || periodStart > today) return null;

        const anchorDay = service.billingAnchorDay ?? 1;
        const nextAnchor = nextMonthOnAnchor(periodStart, anchorDay);
        const periodEnd = addDays(nextAnchor, -1);

        // Backstop for anything that predates the lock: one invoice per
        // service and period, ever.
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
            .set({ nextInvoiceDate: nextAnchor })
            .where(eq(services.id, service.id));
          return null;
        }

        const [plan] = await tx
          .select()
          .from(plans)
          .where(eq(plans.id, service.planId))
          .limit(1);
        if (!plan) {
          throw new Error(`Service ${service.id} points at a missing plan`);
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
          .set({ nextInvoiceDate: nextAnchor })
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
    } catch (err) {
      failed++;
      console.error(
        `invoice generation failed for service ${row.id} on ${today}:`,
        err
      );
      continue;
    }

    if (invoiceId) {
      created.push(invoiceId);
      // The invoice is committed. A notification that fails is worth logging,
      // never worth losing the rest of the run over.
      try {
        await notifyInvoiceIssued(invoiceId);
      } catch (err) {
        console.error(`invoice ${invoiceId} issued but not notified:`, err);
      }
    }
  }
  if (failed > 0) {
    console.error(
      `invoice generation on ${today}: ${created.length} issued, ${failed} of ${due.length} services failed`
    );
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

/** Invoice statuses, as the database defines them. */
type InvoiceStatusValue = (typeof invoices.$inferSelect)["status"];

/**
 * How money that arrived relates to the invoice it names.
 *
 * `applied` is the ordinary case. `overpaid` settles the invoice and leaves
 * change over. `unallocated` is money the invoice cannot absorb at all, on an
 * invoice that is already settled, void or written off. The last two are
 * banked exactly like the first: the difference is that a person has to
 * decide where the surplus goes.
 */
export type PaymentDisposition = "applied" | "overpaid" | "unallocated";

export type GatewayPaymentDecision =
  | {
      accepted: true;
      disposition: PaymentDisposition;
      /** Owed on the invoice before this payment. */
      outstandingCents: Cents;
      /** Completed payments against the invoice once this one is banked. */
      paidTotalCents: Cents;
      /** The part of this payment the invoice could not absorb. */
      excessCents: Cents;
      /** This payment takes the invoice to paid. */
      settles: boolean;
      /** Plain words for the audit trail and the operator's queue. */
      note?: string;
    }
  | { accepted: false; reason: string };

/**
 * Pure settlement rule for one gateway payment, kept separate from the
 * database so it can be reasoned about and tested on its own.
 *
 * The governing fact is that the card has already been debited by the time
 * this runs. Refusing the money does not give it back to the customer, it
 * only removes our record of having taken it. So the only payment refused
 * here is one where no money moved at all, an amount of zero or less.
 *
 * Everything else is banked. Money for less than the balance leaves the
 * invoice open for the rest; money for the balance or more settles it; money
 * for an invoice that is already settled, void or written off is banked
 * against that invoice and flagged, because financial rows are never deleted
 * (§16.4) and only a person can decide between allocating it elsewhere and
 * refunding it.
 */
export function gatewayPaymentOutcome(input: {
  status: InvoiceStatusValue;
  totalCents: Cents;
  alreadyPaidCents: Cents;
  amountCents: Cents;
}): GatewayPaymentDecision {
  if (input.amountCents <= 0) {
    return { accepted: false, reason: "Payment amount must be more than R0.00" };
  }
  const outstanding = outstandingCents(input.totalCents, input.alreadyPaidCents);
  const paidTotalCents = add(input.alreadyPaidCents, input.amountCents);
  const closed = input.status === "void" || input.status === "written_off";

  if (closed || input.status === "paid" || outstanding === 0) {
    const because = closed
      ? `the invoice is ${input.status.replace("_", " ")}`
      : "nothing was outstanding on the invoice";
    return {
      accepted: true,
      disposition: "unallocated",
      outstandingCents: outstanding,
      paidTotalCents,
      excessCents: input.amountCents,
      settles: false,
      note:
        `${formatCents(input.amountCents)} arrived but ${because}, so none of ` +
        `it could be applied. It needs allocating to another invoice or refunding.`,
    };
  }

  const excessCents =
    input.amountCents > outstanding
      ? subtract(input.amountCents, outstanding)
      : 0;
  return {
    accepted: true,
    disposition: excessCents > 0 ? "overpaid" : "applied",
    outstandingCents: outstanding,
    paidTotalCents,
    excessCents,
    settles: paidTotalCents >= input.totalCents,
    note:
      excessCents > 0
        ? `${formatCents(input.amountCents)} arrived against ` +
          `${formatCents(outstanding)} outstanding. The invoice is settled and ` +
          `the ${formatCents(excessCents)} over needs allocating or refunding.`
        : undefined,
  };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Best effort for work that happens after the money is already committed:
 * a notification or a follow-up sweep that fails must never be reported back
 * as a payment we failed to record.
 */
async function safely(
  label: string,
  work: () => Promise<unknown>
): Promise<void> {
  try {
    await work();
  } catch (err) {
    console.error(`${label} failed:`, err);
  }
}

/** Bell rows for every active admin, written inside the caller's transaction. */
async function flagForOperator(
  tx: Tx,
  input: { type: string; title: string; body: string; link: string }
): Promise<void> {
  const admins = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.status, "active")));
  if (admins.length === 0) {
    console.error(`no active admin to flag: ${input.title}`);
    return;
  }
  await tx.insert(notifications).values(
    admins.map((a) => ({
      userId: a.id,
      type: input.type,
      title: input.title,
      body: input.body,
      link: input.link,
    }))
  );
}

export interface GatewayPaymentResult {
  ok: boolean;
  /** This gateway ref was already banked; nothing was written this time. */
  alreadyPaid: boolean;
  settled: boolean;
  paidCents: Cents;
  outstandingCents: Cents;
  disposition: PaymentDisposition | "duplicate";
  /** Banked money the invoice could not absorb, waiting on an operator. */
  unallocatedCents: Cents;
}

/**
 * Bank a gateway payment against an invoice (ITN pay-link or token charge).
 * Idempotent on the gateway ref; clears dunning and auto-reactivates once the
 * invoice is settled.
 *
 * The one rule this function will not break is that money PayFast says it
 * took is always written down. The amount does not have to equal the invoice
 * total, and the invoice does not have to be open. A customer paying the
 * balance of a part-paid invoice, a second tab that debits the card twice, a
 * retried ITN that arrives under a new pf_payment_id, an EFT that settled the
 * invoice an hour before the card did: in every one of those the customer has
 * been charged, so a payment row is written. Where the invoice cannot absorb
 * it, the money is banked against that invoice anyway and raised as an
 * exception for an operator to allocate or refund, with an audit row, a
 * domain event and a bell.
 *
 * Idempotency is on the gateway ref and nothing else, so replays are free and
 * genuinely new debits are never mistaken for them.
 *
 * One charge can reach here under two different references. A token charge
 * PayFast confirms without naming a transaction is banked under a reference
 * derived from its `m_payment_id`; PayFast then posts an ITN for that same
 * debit carrying its own `pf_payment_id`. Those are different keys for one
 * movement of money, so callers that know the `m_payment_id` PayFast echoed
 * pass it as `merchantRef`, and the derived reference is checked as an
 * idempotency key too. Where it matches, the placeholder is replaced by
 * PayFast's own reference and the money is banked once.
 */
export async function markInvoicePaidFromGateway(input: {
  invoiceId: string;
  gatewayRef: string;
  amountCents: number;
  method: "payfast_card" | "payfast_token";
  /**
   * The `m_payment_id` PayFast echoed back, when the caller has it. Only used
   * to recognise a charge already banked under a reference derived from it.
   */
  merchantRef?: string;
}): Promise<GatewayPaymentResult> {
  const gatewayRef = input.gatewayRef?.trim();
  if (!gatewayRef) {
    // Without a reference there is no idempotency key and a retry would bank
    // the same money twice. Refuse before anything is written.
    throw new Error("A gateway reference is required to bank a payment");
  }
  const merchantRef = input.merchantRef?.trim();
  // The reference this same charge would already be banked under if it was a
  // token charge the gateway confirmed without naming a transaction.
  const blindRef =
    merchantRef && !isDerivedGatewayRef(gatewayRef)
      ? derivedGatewayRef(merchantRef)
      : null;

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

    // The gateway ref is the idempotency key, so it is checked first and on
    // its own. A replayed ITN carries a ref we have already banked. A genuine
    // second debit carries a new one, and that money is real whatever state
    // the invoice happens to be in.
    //
    // The derived reference is checked alongside it, and only ever as an exact
    // key: it is the same `m_payment_id` PayFast is now quoting back, so a
    // match is this charge and no other. Nothing here guesses from amounts,
    // because a customer who paid a pay link at the same moment as a token
    // charge really was debited twice, and merging those would quietly cost
    // them the second payment.
    const bankedColumns = {
      id: payments.id,
      ref: payments.gatewayRef,
      amountCents: payments.amountCents,
    };
    const [exact] = await tx
      .select(bankedColumns)
      .from(payments)
      .where(eq(payments.gatewayRef, gatewayRef))
      .limit(1);
    // The derived key is only ever looked for on this invoice: it is our own
    // reference, and reconciling it onto a payment banked elsewhere would move
    // a reference between two different debts.
    const [blind] =
      exact || !blindRef
        ? []
        : await tx
            .select(bankedColumns)
            .from(payments)
            .where(
              and(
                eq(payments.gatewayRef, blindRef),
                eq(payments.invoiceId, invoice.id)
              )
            )
            .limit(1);
    const duplicate = exact ?? blind;
    if (duplicate) {
      if (blindRef && duplicate.ref === blindRef) {
        // This is PayFast telling us what it called the charge we had to bank
        // blind. Carry its reference onto the payment so the ledger and the
        // PayFast dashboard finally name the same transaction.
        await tx
          .update(payments)
          .set({ gatewayRef })
          .where(eq(payments.id, duplicate.id));
        await writeAudit(tx, {
          actor: null,
          action: "payment.reconciled",
          entity: "invoice",
          entityId: invoice.id,
          before: { gatewayRef: blindRef, amountCents: duplicate.amountCents },
          after: {
            gatewayRef,
            merchantRef,
            amountCents: input.amountCents,
            note:
              `The gateway confirmed this charge without naming it, so it was ` +
              `banked under ${blindRef}. PayFast has now reported it as ` +
              `${gatewayRef}; it is one payment, not two.`,
          },
        });
        if (duplicate.amountCents !== input.amountCents) {
          // Same charge, different money. Somebody has to look at that.
          await flagForOperator(tx, {
            type: `payment_amount_mismatch:${gatewayRef}`,
            title: `Check ${invoice.number}: PayFast reports ${formatCents(input.amountCents)} for a charge banked at ${formatCents(duplicate.amountCents)}`,
            body:
              `The charge banked under ${blindRef} was recorded as ` +
              `${formatCents(duplicate.amountCents)}. PayFast now reports ` +
              `${formatCents(input.amountCents)} under ${gatewayRef}. The ` +
              `payment has not been changed; confirm which figure is right.`,
            link: `/admin/customers/${invoice.customerId}?tab=billing`,
          });
        }
      }
      const paidCents = await paidCentsFor(tx, invoice.id);
      return {
        invoice,
        alreadyPaid: true,
        disposition: "duplicate" as const,
        settled: invoice.status === "paid",
        paidCents,
        unallocatedCents: 0,
      };
    }

    const alreadyPaidCents = await paidCentsFor(tx, invoice.id);
    const decision = gatewayPaymentOutcome({
      status: invoice.status,
      totalCents: invoice.totalCents,
      alreadyPaidCents,
      amountCents: input.amountCents,
    });
    // Only a zero or negative amount gets here, which means no money moved.
    if (!decision.accepted) throw new Error(decision.reason);

    await tx.insert(payments).values({
      invoiceId: invoice.id,
      method: input.method,
      amountCents: input.amountCents,
      status: "complete",
      gatewayRef,
    });

    // The invoice's own status logic is unchanged: it settles only when the
    // money banked against it covers it, and a void or written-off invoice is
    // never revived by a payment landing on it.
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

    const action =
      decision.disposition === "unallocated"
        ? "payment.unallocated"
        : decision.disposition === "overpaid"
          ? "payment.overpaid"
          : decision.settles
            ? "invoice.paid"
            : "invoice.part_paid";

    await writeAudit(tx, {
      actor: null,
      action,
      entity: "invoice",
      entityId: invoice.id,
      before: { status: invoice.status, paidCents: alreadyPaidCents },
      after: {
        status: decision.settles ? "paid" : invoice.status,
        method: input.method,
        gatewayRef,
        amountCents: input.amountCents,
        paidCents: decision.paidTotalCents,
        outstandingCents: outstandingCents(
          invoice.totalCents,
          decision.paidTotalCents
        ),
        unallocatedCents: decision.excessCents,
        disposition: decision.disposition,
        ...(decision.note ? { note: decision.note } : {}),
      },
    });
    eventIds.push(
      await emitDomainEvent(tx, "payment.received", {
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        amountCents: input.amountCents,
        method: input.method,
        settled: decision.settles,
        disposition: decision.disposition,
        unallocatedCents: decision.excessCents,
      })
    );

    if (decision.excessCents > 0) {
      eventIds.push(
        await emitDomainEvent(tx, "payment.unallocated", {
          invoiceId: invoice.id,
          customerId: invoice.customerId,
          gatewayRef,
          method: input.method,
          amountCents: input.amountCents,
          unallocatedCents: decision.excessCents,
          invoiceStatus: invoice.status,
          reason: decision.note ?? "",
        })
      );
      await flagForOperator(tx, {
        type: `payment_unallocated:${gatewayRef}`,
        title: `Allocate ${formatCents(decision.excessCents)} received on ${invoice.number}`,
        body: decision.note ?? "",
        link: `/admin/customers/${invoice.customerId}?tab=billing`,
      });
      console.warn(
        `unallocated payment: invoice=${invoice.id} number=${invoice.number} ` +
          `status=${invoice.status} gatewayRef=${gatewayRef} ` +
          `amountCents=${input.amountCents} unallocatedCents=${decision.excessCents}`
      );
    }

    return {
      invoice,
      alreadyPaid: false,
      disposition: decision.disposition,
      settled: decision.settles,
      paidCents: decision.paidTotalCents,
      unallocatedCents: decision.excessCents,
    };
  });

  for (const id of eventIds) await forwardDomainEvent(id);

  // Everything from here runs after the payment is committed, so none of it
  // may throw: a caller that catches an exception from this function has to be
  // able to read it as "the money was not recorded".
  if (!outcome.alreadyPaid) {
    // The customer was debited, so they get their receipt either way. Where
    // the money went is our problem to sort out, not theirs.
    await safely("payment_received notification", () =>
      notify("payment_received", {
        customerId: outcome.invoice.customerId,
        amountCents: input.amountCents,
        reference: outcome.invoice.number,
      })
    );
    if (outcome.settled) {
      await safely(
        `reactivation after settling ${outcome.invoice.number}`,
        () => maybeReactivateAfterSettlement(outcome.invoice.customerId)
      );
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
    disposition: outcome.disposition,
    unallocatedCents: outcome.unallocatedCents,
  };
}

// ----------------------------------------------------------- token charges

/**
 * Put a card charge that went wrong in front of a person: audit row, domain
 * event and a bell for every admin. Used when a debit succeeded but could not
 * be recorded, and when the gateway call itself errored so we cannot tell
 * whether the customer was charged. Both are money problems that no automatic
 * retry should be allowed to guess at.
 */
async function recordChargeException(
  invoice: { id: string; number: string; customerId: string },
  amountCents: Cents,
  headline: string,
  detail: string
): Promise<void> {
  const eventIds: string[] = [];
  await db.transaction(async (tx) => {
    await writeAudit(tx, {
      actor: null,
      action: "payment.exception",
      entity: "invoice",
      entityId: invoice.id,
      after: { headline, detail, amountCents },
    });
    eventIds.push(
      await emitDomainEvent(tx, "payment.exception", {
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        amountCents,
        headline,
        detail,
      })
    );
    await flagForOperator(tx, {
      type: `payment_exception:${invoice.id}:${headline}`,
      title: `${headline}: ${invoice.number}, ${formatCents(amountCents)}`,
      body: detail,
      link: `/admin/customers/${invoice.customerId}?tab=billing`,
    });
  });
  for (const id of eventIds) await forwardDomainEvent(id);
}

/** Audit actions that carry the charging halt. Append-only, so never deleted. */
const CHARGING_HALTED = "invoice.charging_halted";
const CHARGING_RESUMED = "invoice.charging_resumed";

export interface ChargingHalt {
  halted: boolean;
  /** Why, in the words the halt was recorded with. */
  reason?: string;
  since?: Date;
}

/**
 * Is this invoice barred from automatic card charging, and why?
 *
 * The halt used to be nothing but the skipped `collection_attempts` rows
 * written for the remaining dunning slots, and slot rows are not a durable
 * stop condition. They record nothing at all when the last slot has already
 * run, they say nothing about why on the invoice itself, and they quietly stop
 * covering anything the moment `chargeAttemptDays` gains a slot in settings.
 * An invoice taken off charging because the customer might already have been
 * debited would then be charged again by the new slot.
 *
 * So the halt is a fact in the audit log: append-only, timestamped, attributed,
 * already the record an operator reads, and independent of how many slots the
 * timeline happens to have. A later `invoice.charging_resumed` row lifts it, so
 * a person can deliberately put an invoice back on the timeline.
 */
export async function automaticChargingHalted(
  invoiceId: string
): Promise<ChargingHalt> {
  const [latest] = await db
    .select({
      action: auditLog.action,
      after: auditLog.after,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.entity, "invoice"),
        eq(auditLog.entityId, invoiceId),
        inArray(auditLog.action, [CHARGING_HALTED, CHARGING_RESUMED])
      )
    )
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(1);
  if (!latest || latest.action !== CHARGING_HALTED) return { halted: false };
  const reason =
    typeof latest.after?.reason === "string" ? latest.after.reason : undefined;
  return { halted: true, reason, since: latest.createdAt };
}

/**
 * Stop the dunning sweep from ever charging this invoice automatically again.
 *
 * Used wherever the card may already have been debited for money we cannot
 * see, because the one thing that must not happen while a person works out
 * what took place is another guess with the same customer's money.
 *
 * The audit row is written first, because that is the stop condition. The
 * skipped slot rows follow so the invoice's attempt list reads honestly, and
 * the bell puts the reason in front of someone the same night rather than
 * leaving it buried in a detail column.
 */
async function haltAutomaticCharging(
  invoiceId: string,
  afterAttemptNo: number,
  reason: string
): Promise<void> {
  const [invoice] = await db
    .select({
      id: invoices.id,
      number: invoices.number,
      customerId: invoices.customerId,
    })
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  if (!invoice) {
    console.error(`cannot halt charging, invoice ${invoiceId} not found`);
    return;
  }

  const already = await automaticChargingHalted(invoiceId);
  if (!already.halted) {
    const eventIds: string[] = [];
    await db.transaction(async (tx) => {
      await writeAudit(tx, {
        actor: null,
        action: CHARGING_HALTED,
        entity: "invoice",
        entityId: invoiceId,
        after: { reason, afterAttemptNo },
      });
      eventIds.push(
        await emitDomainEvent(tx, CHARGING_HALTED, {
          invoiceId,
          customerId: invoice.customerId,
          reason,
          afterAttemptNo,
        })
      );
      await flagForOperator(tx, {
        type: `charging_halted:${invoiceId}`,
        title: `Automatic card charging stopped on ${invoice.number}`,
        body:
          `${reason}. Nothing more will be charged to this customer's card ` +
          `for this invoice until someone puts it back on the timeline.`,
        link: `/admin/customers/${invoice.customerId}?tab=billing`,
      });
    });
    for (const id of eventIds) await forwardDomainEvent(id);
    console.warn(
      `automatic charging halted: invoice=${invoiceId} number=${invoice.number} ` +
        `afterAttemptNo=${afterAttemptNo}: ${reason}`
    );
  }

  // Slot rows as well, so the attempt list on the invoice says why the
  // remaining charge days came and went. They no longer carry the stop on
  // their own, and a resume is free to ignore them.
  const dunning = await getSettingOr<DunningConfig>("dunning", DEFAULT_DUNNING);
  const existing = await db
    .select({ attemptNo: collectionAttempts.attemptNo })
    .from(collectionAttempts)
    .where(eq(collectionAttempts.invoiceId, invoiceId));
  const taken = new Set(existing.map((row) => row.attemptNo));

  const now = new Date();
  const rows = [];
  for (
    let attemptNo = afterAttemptNo + 1;
    attemptNo <= dunning.chargeAttemptDays.length;
    attemptNo++
  ) {
    if (taken.has(attemptNo)) continue;
    rows.push({
      invoiceId,
      attemptNo,
      scheduledFor: now,
      executedAt: now,
      result: "skipped" as const,
      detail: `not charged automatically: ${reason}`,
    });
  }
  if (rows.length === 0) return;
  await db.insert(collectionAttempts).values(rows);
}

const resumeChargingSchema = z.object({
  invoiceId: z.string().uuid(),
  reason: z
    .string()
    .trim()
    .min(4, "Give a reason of at least 4 characters")
    .max(500),
});
export type ResumeChargingInput = z.infer<typeof resumeChargingSchema>;

/**
 * Put a halted invoice back on the automatic charging timeline.
 *
 * A halt means somebody has to check with PayFast whether the customer was
 * actually debited, so lifting it is a deliberate, attributed act: this is the
 * counterpart that makes the halt reversible without anyone editing rows by
 * hand. It says nothing about what happened, only that the person who looked
 * is satisfied the card can be charged again.
 */
export async function resumeAutomaticCharging(
  actor: Actor,
  rawInput: ResumeChargingInput
): Promise<void> {
  authorize(actor, "billing.reconciliation");
  const input = resumeChargingSchema.parse(rawInput);

  const [invoice] = await db
    .select({ id: invoices.id, customerId: invoices.customerId })
    .from(invoices)
    .where(eq(invoices.id, input.invoiceId))
    .limit(1);
  if (!invoice) throw new Error("Invoice not found");
  const halt = await automaticChargingHalted(input.invoiceId);
  if (!halt.halted) {
    throw new Error("This invoice is not being held off automatic charging");
  }

  const eventId = await db.transaction(async (tx) => {
    await writeAudit(tx, {
      actor,
      action: CHARGING_RESUMED,
      entity: "invoice",
      entityId: input.invoiceId,
      before: { reason: halt.reason ?? null, since: halt.since ?? null },
      after: { reason: input.reason },
    });
    return emitDomainEvent(tx, CHARGING_RESUMED, {
      invoiceId: input.invoiceId,
      customerId: invoice.customerId,
      reason: input.reason,
    });
  });
  await forwardDomainEvent(eventId);
}

/** What the gateway answered, or the fact that asking it threw. */
export type ChargeAnswer =
  | { kind: "errored"; message: string }
  | { kind: "replied"; ok: boolean; gatewayRef?: string; detail?: string };

export interface ChargeDisposition {
  /**
   * What the caller is told. A debit that happened is never reported as a
   * failure: a failure means "try again", and trying again takes the same
   * money a second time.
   */
  result: "success" | "failed";
  /** Reference to bank the money under, null when nothing may be banked. */
  bankUnder: string | null;
  attemptResult: "success" | "failed";
  /** Goes on the collection attempt, and to the operator. */
  detail: string;
  /** Headline for the operator's bell, null when nobody needs to look. */
  exception: string | null;
  /** False forbids every later dunning slot from charging this invoice. */
  mayRecharge: boolean;
}

/**
 * What to do about one answer from the card gateway. Pure, so the rule can be
 * read and tested without a database or a PayFast account.
 *
 * The pivot is whether the customer's money moved. PayFast replying `ok`
 * means it did, and that stays true whether or not the reply carried a
 * reference we can read. Recording such a charge as a failure lost the money
 * twice over: nothing was banked against the invoice, so it stayed open, and
 * the next dunning slot debited the customer again for what had already been
 * taken. So a successful debit is always recorded, under the gateway's own
 * reference where there is one and otherwise under one derived from the
 * `m_payment_id` we sent with the request, which is the identifier PayFast has
 * on its side and the one an operator reconciles against. Anything ambiguous
 * also raises a bell and takes the invoice off automatic charging until a
 * person has looked.
 *
 * A derived reference is treated exactly like a missing one, because that is
 * what it means: the gateway confirmed the debit and named no transaction.
 */
export function tokenChargeDisposition(input: {
  answer: ChargeAnswer;
  /** The `m_payment_id` sent with the charge, our side of the reconciliation. */
  paymentId: string;
}): ChargeDisposition {
  const { answer, paymentId } = input;

  if (answer.kind === "errored") {
    // The call itself threw, so whether the card was debited is unknown.
    // Never guess with somebody's money.
    return {
      result: "failed",
      bankUnder: null,
      attemptResult: "failed",
      detail: `charge errored, outcome unknown: ${answer.message}`,
      exception: "Card charge outcome unknown",
      mayRecharge: false,
    };
  }

  if (!answer.ok) {
    // A clean decline: no money moved, so the timeline retries as designed.
    return {
      result: "failed",
      bankUnder: null,
      attemptResult: "failed",
      detail: answer.detail ?? "charge failed",
      exception: null,
      mayRecharge: true,
    };
  }

  const gatewayRef = answer.gatewayRef?.trim();
  if (gatewayRef && !isDerivedGatewayRef(gatewayRef)) {
    return {
      result: "success",
      bankUnder: gatewayRef,
      attemptResult: "success",
      detail: gatewayRef,
      exception: null,
      mayRecharge: true,
    };
  }

  // No reference, or one we minted ourselves. Either way the debit is real and
  // unnamed, and it banks under the single derived reference both this path
  // and `chargeToken` agree on, unique to this invoice and this attempt.
  const bankUnder = gatewayRef ?? derivedGatewayRef(paymentId);
  return {
    result: "success",
    bankUnder,
    attemptResult: "success",
    detail:
      `the gateway reported success without a reference of its own, so the ` +
      `payment is recorded under ${bankUnder}, derived from the m_payment_id ` +
      `it was charged with, ${paymentId}`,
    exception: "Card charge without a gateway reference",
    mayRecharge: false,
  };
}

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
  // A halt outlives the dunning slots that were open when it was recorded, so
  // it is read before anything else touches the card.
  const halt = await automaticChargingHalted(invoiceId);
  if (halt.halted) {
    return {
      result: "skipped",
      detail: `automatic charging halted: ${halt.reason ?? "reason not recorded"}`,
    };
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

  const paymentId = `inv:${invoice.id}:${attemptNo}`;
  let answer: ChargeAnswer;
  try {
    const charge = await charger({
      token: method.payfastToken,
      amountCents: dueCents,
      itemName: `Needd Connect invoice ${invoice.number}`,
      paymentId,
    });
    answer = { ...charge, kind: "replied" };
  } catch (err) {
    console.error(
      `token charge errored: invoice=${invoice.id} number=${invoice.number} amountCents=${dueCents}:`,
      err
    );
    answer = { kind: "errored", message: errorText(err) };
  }

  const decision = tokenChargeDisposition({ answer, paymentId });
  if (decision.exception) {
    console.error(
      `${decision.exception.toUpperCase()}: invoice=${invoice.id} ` +
        `number=${invoice.number} customer=${invoice.customerId} ` +
        `amountCents=${dueCents} paymentId=${paymentId}: ${decision.detail}`
    );
  }
  // Everything below this point is best effort. The customer's card has
  // already been touched, so nothing here may throw its way back out and be
  // read as "the charge did not happen".

  await safely("collection attempt update", () =>
    db
      .update(collectionAttempts)
      .set({ result: decision.attemptResult, detail: decision.detail })
      .where(eq(collectionAttempts.id, attemptId))
  );

  if (decision.bankUnder) {
    try {
      await markInvoicePaidFromGateway({
        invoiceId,
        gatewayRef: decision.bankUnder,
        amountCents: dueCents,
        method: "payfast_token",
        merchantRef: paymentId,
      });
    } catch (err) {
      // The card has been debited. A record we fail to write here is money the
      // customer paid and we cannot see, so it is logged loudly, left as an
      // operator task, and never handed back to the retry loop.
      const detail =
        `charged ${formatCents(dueCents)} on gateway ref ${decision.bankUnder}, ` +
        `but the payment could not be recorded: ${errorText(err)}`;
      console.error(
        `UNBANKED CARD DEBIT: invoice=${invoice.id} number=${invoice.number} ` +
          `customer=${invoice.customerId} gatewayRef=${decision.bankUnder} ` +
          `amountCents=${dueCents}:`,
        err
      );
      await safely("collection attempt update", () =>
        db
          .update(collectionAttempts)
          .set({ result: "success", detail })
          .where(eq(collectionAttempts.id, attemptId))
      );
      await safely("charge exception record", () =>
        recordChargeException(
          invoice,
          dueCents,
          "Card debited but not recorded",
          `${detail}. Capture it against ${invoice.number} using gateway ref ${decision.bankUnder}.`
        )
      );
      await safely("halt automatic charging", () =>
        haltAutomaticCharging(invoice.id, attemptNo, detail)
      );
      // The money did leave the customer's account, so this was a successful
      // charge. Calling it a failure would have the next dunning slot debit
      // them a second time.
      return { result: "success", detail };
    }
  }

  const exception = decision.exception;
  if (exception) {
    await safely("charge exception record", () =>
      recordChargeException(
        invoice,
        dueCents,
        exception,
        `${decision.detail}. Check PayFast for ${paymentId} and confirm it against ${invoice.number}. This invoice will not be charged automatically again.`
      )
    );
  }
  if (!decision.mayRecharge) {
    await safely("halt automatic charging", () =>
      haltAutomaticCharging(invoice.id, attemptNo, decision.detail)
    );
  }
  if (decision.result === "failed" && exception === null) {
    // A clean decline, the only outcome the customer can act on. A
    // notification outage is not a reason to lose the recorded decline.
    await safely("payment_failed notification", () =>
      notify("payment_failed", {
        customerId: invoice.customerId,
        amountCents: dueCents,
        reference: invoice.number,
        link: payLinkFor(invoiceId),
      })
    );
  }
  return { result: decision.result, detail: decision.detail };
}

// ---------------------------------------------------------------- dunning

/**
 * Daily dunning sweep (§6.3). Timeline relative to invoice issue date:
 * day 0 charge #1, +2 charge #2, +5 charge #3, +7 past_due warning,
 * +10 suspend, +40 admin decision. Explicit `today` for time-travel tests.
 *
 * Every invoice is isolated: one that throws is logged with its id, counted
 * and stepped over, so a single bad row can never stop the customers behind
 * it from being chased. The failure count comes back with the run so the
 * night's report says what actually happened rather than reporting a clean
 * sweep it did not finish.
 */
export async function runDunning(
  today = todayInJohannesburg(),
  opts: { charger?: Charger } = {}
): Promise<{ processed: number; failed: number }> {
  const dunning = await getSettingOr<DunningConfig>("dunning", DEFAULT_DUNNING);
  const open = await db
    .select()
    .from(invoices)
    .where(inArray(invoices.status, ["open", "past_due"]));

  let processed = 0;
  let failed = 0;
  for (const invoice of open) {
    const age = daysBetween(invoice.issueDate, today);
    if (age < 0) continue;
    processed++;
    try {
      await dunInvoice(invoice, age, today, dunning, opts);
    } catch (err) {
      failed++;
      console.error(
        `dunning failed for invoice ${invoice.number} (${invoice.id}) on ${today}, age ${age}:`,
        err
      );
    }
  }
  if (failed > 0) {
    console.error(
      `dunning on ${today}: ${processed} invoices considered, ${failed} failed`
    );
  }
  return { processed, failed };
}

/** One invoice's turn through the dunning timeline. Throws on its own row only. */
async function dunInvoice(
  invoice: typeof invoices.$inferSelect,
  age: number,
  today: string,
  dunning: DunningConfig,
  opts: { charger?: Charger }
): Promise<void> {
  // Token charge attempts on the configured days (only once per day-slot).
  //
  // A slot is spent when something actually reached the gateway in it: a
  // success, a decline, or a row still in flight, which is treated as spent
  // because a charge whose outcome we never recorded must never be repeated.
  // Skipped rows do not spend a slot. They are written when there was nothing
  // to collect, or by a halt, and the halt itself is what stops the charging
  // now, so a lifted halt genuinely puts the invoice back on the timeline.
  const attemptIndex = dunning.chargeAttemptDays.indexOf(age);
  if (attemptIndex >= 0) {
    const [already] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(collectionAttempts)
      .where(
        and(
          eq(collectionAttempts.invoiceId, invoice.id),
          eq(collectionAttempts.attemptNo, attemptIndex + 1),
          sql`(${collectionAttempts.result} is null or ${collectionAttempts.result} <> 'skipped')`
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
  if (!current || current.status === "paid") return;

  // Everything below chases a debt, so the debt decides, not the status
  // column. An invoice can be fully covered and still sit at open or past_due:
  // a credit that exactly met the balance, a payment banked while the status
  // write was lost, a net-zero plan-change adjustment. Escalating on status
  // alone marked those customers past due, then suspended a service over
  // money nobody owed.
  const paidCents = await paidCentsForInvoice(current.id);
  const dueCents = outstandingCents(current.totalCents, paidCents);
  if (dueCents === 0) {
    await settleInvoiceWithNoBalance(current, paidCents);
    return;
  }

  // past_due at +pastDueDay with the 3-day warning (§6.3).
  if (age >= dunning.pastDueDay && current.status === "open") {
    // What we tell the customer they owe is the balance, not the total: a
    // part payment leaves the invoice open on purpose (§6.2).
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
    // The status change is committed. A notification that fails must not undo
    // the rest of this invoice's timeline.
    await safely("past_due_warning notification", () =>
      notify("past_due_warning", {
        customerId: current.customerId,
        amountCents: dueCents,
        reference: current.number,
        link: payLinkFor(invoice.id),
      })
    );
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
      await safely("service_suspended notification", () =>
        notify("service_suspended", {
          customerId: current.customerId,
          serviceName: plan?.name ?? "service",
          reference: current.number,
          link: payLinkFor(invoice.id),
        })
      );
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
      const [customer] = await db
        .select()
        .from(customers)
        .where(eq(customers.id, current.customerId))
        .limit(1);
      const name =
        customer?.companyName ??
        [customer?.firstName, customer?.lastName].filter(Boolean).join(" ");
      await db.transaction((tx) =>
        flagForOperator(tx, {
          type: marker,
          title: `Decision needed: ${name}, ${current.number} unpaid ${age} days`,
          body: "Suspended for 30 days. Cancel the service or write off the invoice; nothing happens automatically.",
          link: `/admin/customers/${current.customerId}?tab=billing`,
        })
      );
    }
  }
}

/**
 * Close an invoice the sweep found with nothing left owing on it.
 *
 * Leaving it open is not harmless. It keeps chasing a customer who owes
 * nothing, it keeps `maybeReactivateAfterSettlement` from bringing their
 * service back (that counts open invoices, not balances), and it overstates
 * the book. So the sweep settles it, audited, saying plainly that the balance
 * and not a payment is what closed it. Nothing is deleted and no money moves.
 */
async function settleInvoiceWithNoBalance(
  invoice: typeof invoices.$inferSelect,
  paidCents: Cents
): Promise<void> {
  const eventIds: string[] = [];
  await db.transaction(async (tx) => {
    // Re-read under a lock: a payment landing at the same moment must not have
    // its settlement overwritten by this one.
    const [locked] = await tx
      .select()
      .from(invoices)
      .where(eq(invoices.id, invoice.id))
      .limit(1)
      .for("update");
    if (!locked || locked.status === "paid") return;
    if (locked.status === "void" || locked.status === "written_off") return;
    const settledCents = await paidCentsFor(tx, locked.id);
    if (outstandingCents(locked.totalCents, settledCents) > 0) return;

    await tx
      .update(invoices)
      .set({ status: "paid", paidAt: new Date() })
      .where(eq(invoices.id, locked.id));
    await tx
      .update(collectionAttempts)
      .set({ result: "skipped", detail: "nothing outstanding" })
      .where(
        and(
          eq(collectionAttempts.invoiceId, locked.id),
          isNull(collectionAttempts.executedAt)
        )
      );
    await writeAudit(tx, {
      actor: null,
      action: "invoice.settled_no_balance",
      entity: "invoice",
      entityId: locked.id,
      before: { status: locked.status, paidCents: settledCents },
      after: {
        status: "paid",
        totalCents: locked.totalCents,
        paidCents: settledCents,
        note:
          `Dunning found nothing outstanding on this invoice, so it was ` +
          `closed rather than chased. No payment was recorded here.`,
      },
    });
    eventIds.push(
      await emitDomainEvent(tx, "invoice.settled", {
        invoiceId: locked.id,
        customerId: locked.customerId,
        totalCents: locked.totalCents,
        paidCents: settledCents,
        reason: "no balance outstanding",
      })
    );
  });
  for (const id of eventIds) await forwardDomainEvent(id);
  console.warn(
    `invoice ${invoice.number} was open with nothing outstanding ` +
      `(total ${invoice.totalCents}, paid ${paidCents}); closed by the dunning sweep`
  );
  await safely(`reactivation after closing ${invoice.number}`, () =>
    maybeReactivateAfterSettlement(invoice.customerId)
  );
}

// ------------------------------------------------------- lifecycle sweeps

/**
 * Finalize cancellations whose effective date has arrived (§5). Returns how
 * many were actually finalized, not how many were due: one service that
 * throws is logged and stepped over, and the count reflects that honestly.
 */
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
  let finalized = 0;
  for (const service of due) {
    try {
      await finalizeCancellation(service.id);
      finalized++;
    } catch (err) {
      console.error(
        `cancellation sweep failed for service ${service.id} on ${today}:`,
        err
      );
    }
  }
  return finalized;
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

/** Every figure here is what is still owed, never what was invoiced. */
export interface AgeBucket {
  customerId: string;
  customerName: string;
  currentCents: Cents;
  d30Cents: Cents;
  d60Cents: Cents;
  d90Cents: Cents;
  totalCents: Cents;
}

/** One open invoice and the money already banked against it. */
export interface AgedInvoice {
  customerId: string;
  customerName: string;
  /** Calendar date, YYYY-MM-DD; the bucket is measured from here. */
  issueDate: string;
  totalCents: Cents;
  paidCents: Cents;
}

/**
 * Sort what customers owe into 30-day buckets.
 *
 * A part payment deliberately leaves an invoice open (§6.2), so the invoice
 * total is not the debt: an R800 invoice with R600 banked against it belongs
 * in its bucket as R200. Bucketing on the total told a collections call the
 * customer owed money they had already paid, and made the whole book look
 * bigger than it was. Outstanding comes from `outstandingCents`, the same rule
 * the invoice screens and the portal show the customer, so the report and the
 * customer's own statement can never disagree.
 *
 * An invoice with nothing left outstanding is left out entirely rather than
 * carried as a zero: it is settled, whatever its status column still says.
 */
export function bucketAgeAnalysis(
  rows: AgedInvoice[],
  today: string
): AgeBucket[] {
  const map = new Map<string, AgeBucket>();
  for (const row of rows) {
    const owedCents = outstandingCents(row.totalCents, row.paidCents);
    if (owedCents === 0) continue;
    const bucket =
      map.get(row.customerId) ??
      ({
        customerId: row.customerId,
        customerName: row.customerName,
        currentCents: 0,
        d30Cents: 0,
        d60Cents: 0,
        d90Cents: 0,
        totalCents: 0,
      } satisfies AgeBucket);
    const age = daysBetween(row.issueDate, today);
    if (age < 30) bucket.currentCents = add(bucket.currentCents, owedCents);
    else if (age < 60) bucket.d30Cents = add(bucket.d30Cents, owedCents);
    else if (age < 90) bucket.d60Cents = add(bucket.d60Cents, owedCents);
    else bucket.d90Cents = add(bucket.d90Cents, owedCents);
    bucket.totalCents = add(bucket.totalCents, owedCents);
    map.set(row.customerId, bucket);
  }
  return [...map.values()].sort((a, b) => b.totalCents - a.totalCents);
}

export async function ageAnalysis(
  today = todayInJohannesburg()
): Promise<AgeBucket[]> {
  const rows = await db
    .select({ invoice: invoices, customer: customers })
    .from(invoices)
    .innerJoin(customers, eq(invoices.customerId, customers.id))
    .where(inArray(invoices.status, ["open", "past_due"]));

  const paid = await paidCentsByInvoice(rows.map((r) => r.invoice.id));

  return bucketAgeAnalysis(
    rows.map(({ invoice, customer }) => ({
      customerId: customer.id,
      customerName:
        customer.companyName ??
        [customer.firstName, customer.lastName].filter(Boolean).join(" "),
      issueDate: invoice.issueDate,
      totalCents: invoice.totalCents,
      paidCents: paid.get(invoice.id) ?? 0,
    })),
    today
  );
}
