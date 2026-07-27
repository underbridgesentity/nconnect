import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "@/lib/db/client";
import {
  invoices,
  invoiceLines,
  payments,
  services,
  collectionAttempts,
  customers,
} from "@/lib/db/schema";
import { subtract, type Cents } from "@/lib/money";
import { authorize, type Actor } from "@/lib/auth/authorize";
import { writeAudit } from "./audit";
import { emitDomainEvent, forwardDomainEvent } from "./events";
import { reactivateService, todayInJohannesburg } from "./services";
import { notify } from "@/lib/notify";

/**
 * Billing helpers shared by M3 (manual EFT) and the M4 engine. Payment at
 * any point clears the dunning sequence; if the service is suspended and
 * all its past-due invoices settle, reactivation runs automatically (§6.3).
 *
 * Financial rows are never deleted (§16.4). Corrections happen by voiding,
 * writing off, or appending a negative adjustment line, all audited.
 */

/**
 * What a customer actually owes, in integer cents.
 *
 * Invoices carry no amount_paid column and a part payment deliberately leaves
 * the invoice open, so summing `total_cents` tells somebody who has already
 * paid half that they still owe the lot. Every open invoice counts for its
 * total minus the payments completed against it, floored at zero so an
 * over-allocated invoice can never wipe out another invoice's debt. This is
 * the same rule as `app/portal/_lib/balances.ts`, which shows the customer
 * their side of the identical figure.
 */
export async function customerBalanceCents(customerId: string): Promise<number> {
  const paidPerInvoice = sql<number>`coalesce((
    select sum(${payments.amountCents})
    from ${payments}
    where ${payments.invoiceId} = ${invoices.id}
      and ${payments.status} = 'complete'
  ), 0)`;
  const [row] = await db
    .select({
      due: sql<number>`coalesce(sum(greatest(${invoices.totalCents} - ${paidPerInvoice}, 0)), 0)::int`,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.customerId, customerId),
        inArray(invoices.status, ["open", "past_due"])
      )
    );
  return row.due;
}

// ------------------------------------------------------------- shared bits

const uuid = z.string().uuid();
const reasonSchema = z
  .string()
  .trim()
  .min(4, "Give a reason of at least 4 characters")
  .max(500);

/** Money banked, ignoring initiated and failed attempts. One definition. */
const completedPaymentTotal = sql<number>`coalesce(sum(${payments.amountCents}) filter (where ${payments.status} = 'complete'), 0)::int`;

/**
 * Completed payments already banked against an invoice, in cents. Exported
 * so the billing engine banks a gateway payment against the same figure the
 * manual-EFT path uses; call it inside the transaction that will write the
 * payment, so the row lock covers the read.
 */
export async function paidCentsFor(tx: Tx, invoiceId: string): Promise<Cents> {
  const [row] = await tx
    .select({ total: completedPaymentTotal })
    .from(payments)
    .where(eq(payments.invoiceId, invoiceId));
  return row.total;
}

/** The same read outside a transaction, for read-only callers. */
export async function paidCentsForInvoice(invoiceId: string): Promise<Cents> {
  const [row] = await db
    .select({ total: completedPaymentTotal })
    .from(payments)
    .where(eq(payments.invoiceId, invoiceId));
  return row.total;
}

/**
 * What is still owed on one invoice. Floored at zero: an over-allocated
 * invoice is a data problem to investigate, never a credit to spend.
 */
export function outstandingCents(totalCents: Cents, paidCents: Cents): Cents {
  const balance = subtract(totalCents, paidCents);
  return balance > 0 ? balance : 0;
}

/**
 * Completed payments per invoice, for the "R382.00 total, R100.00 paid,
 * R282.00 outstanding" line in the admin billing views.
 */
export async function paidCentsByInvoice(
  invoiceIds: string[]
): Promise<Map<string, number>> {
  if (invoiceIds.length === 0) return new Map();
  const rows = await db
    .select({
      invoiceId: payments.invoiceId,
      total: sql<number>`coalesce(sum(${payments.amountCents}) filter (where ${payments.status} = 'complete'), 0)::int`,
    })
    .from(payments)
    .where(inArray(payments.invoiceId, invoiceIds))
    .groupBy(payments.invoiceId);
  return new Map(rows.map((r) => [r.invoiceId, r.total]));
}

/** Close out any collection attempt still queued against an invoice. */
async function clearPendingAttempts(
  tx: Tx,
  invoiceId: string,
  detail: string
): Promise<void> {
  await tx
    .update(collectionAttempts)
    .set({ result: "skipped", detail })
    .where(
      and(
        eq(collectionAttempts.invoiceId, invoiceId),
        sql`${collectionAttempts.executedAt} is null`
      )
    );
}

/**
 * Card-charge attempts for a set of invoices, newest first. The billing
 * engine writes these; until now nothing read them, so an operator could
 * not tell insufficient funds from an expired card (§6.3).
 */
export async function collectionAttemptsFor(invoiceIds: string[]) {
  if (invoiceIds.length === 0) return [];
  return db
    .select()
    .from(collectionAttempts)
    .where(inArray(collectionAttempts.invoiceId, invoiceIds))
    .orderBy(desc(collectionAttempts.attemptNo));
}

/**
 * Value date of a manual EFT. The operator captures the date the money
 * actually cleared, which is rarely the date they type it in. Midday SAST
 * keeps the instant on the intended calendar day in both UTC and SAST.
 */
function valueDateInstant(paidOn: string | undefined): Date {
  if (!paidOn || paidOn === todayInJohannesburg()) return new Date();
  return new Date(`${paidOn}T12:00:00+02:00`);
}

// -------------------------------------------------------------- manual EFT

const manualPaymentSchema = z.object({
  invoiceId: uuid,
  amountCents: z
    .number()
    .int("Amount must be whole cents")
    .positive("Amount must be more than R0.00"),
  reference: z.string().trim().min(1, "A bank reference is required").max(120),
  /** Calendar date the money cleared, YYYY-MM-DD, never in the future. */
  paidOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Payment date must be a calendar date")
    .refine(
      (value) => value <= todayInJohannesburg(),
      "Payment date cannot be in the future"
    )
    .optional(),
});
export type ManualPaymentInput = z.input<typeof manualPaymentSchema>;

/**
 * Record a manual EFT against an invoice (spec §6.2): audited, and triggers
 * the same payment.received flow so reactivation logic is uniform.
 */
export async function recordManualPayment(
  actor: Actor,
  rawInput: ManualPaymentInput
): Promise<void> {
  authorize(actor, "payment.record_manual");
  const input = manualPaymentSchema.parse(rawInput);
  const receivedAt = valueDateInstant(input.paidOn);

  const outcome = await db.transaction(async (tx) => {
    // Row lock: two operators capturing the same EFT at once must not both
    // read a zero balance and both write a payment.
    const [invoice] = await tx
      .select()
      .from(invoices)
      .where(eq(invoices.id, input.invoiceId))
      .limit(1)
      .for("update");
    if (!invoice) throw new Error("Invoice not found");
    if (invoice.status === "paid") throw new Error("Invoice is already paid");
    if (invoice.status === "void" || invoice.status === "written_off") {
      throw new Error(`Invoice is ${invoice.status}`);
    }

    // `payments.gateway_ref` is unique, so the same bank reference cannot be
    // captured twice. Say so in words rather than leaking a constraint name.
    const [duplicate] = await tx
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.gatewayRef, input.reference))
      .limit(1);
    if (duplicate) {
      throw new Error(
        `Reference "${input.reference}" has already been captured against an invoice`
      );
    }

    // Nothing may over-pay an invoice: financial rows can never be deleted,
    // so a fat-fingered amount would be permanent (§16.4).
    const alreadyPaid = await paidCentsFor(tx, invoice.id);
    const outstanding = outstandingCents(invoice.totalCents, alreadyPaid);
    if (input.amountCents > outstanding) {
      throw new Error(
        `Amount exceeds the R${(outstanding / 100).toFixed(2)} still outstanding on this invoice`
      );
    }

    await tx.insert(payments).values({
      invoiceId: invoice.id,
      method: "eft_manual",
      amountCents: input.amountCents,
      status: "complete",
      gatewayRef: input.reference,
      recordedBy: actor.userId,
      createdAt: receivedAt,
    });

    // Fully covered? (partial payments leave the invoice open)
    const paidTotal = alreadyPaid + input.amountCents;
    const fullyPaid = paidTotal >= invoice.totalCents;

    if (fullyPaid) {
      await tx
        .update(invoices)
        .set({ status: "paid", paidAt: receivedAt })
        .where(eq(invoices.id, invoice.id));
      // Clear any pending collection attempts (§6.3).
      await clearPendingAttempts(tx, invoice.id, "invoice settled");
    }

    await writeAudit(tx, {
      actor,
      action: "payment.record_manual",
      entity: "invoice",
      entityId: invoice.id,
      after: {
        amountCents: input.amountCents,
        reference: input.reference,
        paidOn: input.paidOn ?? todayInJohannesburg(),
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

// ------------------------------------------------- void, write-off, credit

const invoiceReasonSchema = z.object({
  invoiceId: uuid,
  reason: reasonSchema,
});
export type InvoiceReasonInput = z.infer<typeof invoiceReasonSchema>;

/**
 * Void an invoice that should never have been issued (double billing, wrong
 * plan, test data). Refuses once any money has been received against it,
 * because a document money was banked against has to be credited, not
 * erased. Voiding removes the debt, so a service suspended purely for this
 * invoice comes back automatically (§6.3).
 */
export async function voidInvoice(
  actor: Actor,
  rawInput: InvoiceReasonInput
): Promise<void> {
  authorize(actor, "invoice.void");
  const input = invoiceReasonSchema.parse(rawInput);

  const outcome = await db.transaction(async (tx) => {
    const invoice = await lockedOpenInvoice(tx, input.invoiceId);
    const paid = await paidCentsFor(tx, invoice.id);
    if (paid > 0) {
      throw new Error(
        "Money has been received against this invoice. Credit it instead, or write it off."
      );
    }

    await tx
      .update(invoices)
      .set({ status: "void" })
      .where(eq(invoices.id, invoice.id));
    await clearPendingAttempts(tx, invoice.id, "invoice voided");
    await writeAudit(tx, {
      actor,
      action: "invoice.void",
      entity: "invoice",
      entityId: invoice.id,
      before: { status: invoice.status, totalCents: invoice.totalCents },
      after: { status: "void", reason: input.reason },
    });
    const eventId = await emitDomainEvent(tx, "invoice.voided", {
      invoiceId: invoice.id,
      customerId: invoice.customerId,
      totalCents: invoice.totalCents,
      reason: input.reason,
    });
    return { invoice, eventId };
  });

  await forwardDomainEvent(outcome.eventId);
  // The debt is gone, so anything suspended for it should come back.
  await maybeReactivateAfterSettlement(outcome.invoice.customerId);
}

/**
 * Write an invoice off as bad debt: the money is owed but will not be
 * collected. This is the day-40 decision the dunning sweep asks for. Unlike
 * a void it leaves the service exactly as it is, suspended or cancelled,
 * and it keeps any partial payment already banked.
 */
export async function writeOffInvoice(
  actor: Actor,
  rawInput: InvoiceReasonInput
): Promise<void> {
  authorize(actor, "invoice.void");
  const input = invoiceReasonSchema.parse(rawInput);

  const outcome = await db.transaction(async (tx) => {
    const invoice = await lockedOpenInvoice(tx, input.invoiceId);
    const paid = await paidCentsFor(tx, invoice.id);

    await tx
      .update(invoices)
      .set({ status: "written_off" })
      .where(eq(invoices.id, invoice.id));
    await clearPendingAttempts(tx, invoice.id, "invoice written off");
    await writeAudit(tx, {
      actor,
      action: "invoice.write_off",
      entity: "invoice",
      entityId: invoice.id,
      before: { status: invoice.status, totalCents: invoice.totalCents },
      after: {
        status: "written_off",
        reason: input.reason,
        writtenOffCents: invoice.totalCents - paid,
      },
    });
    const eventId = await emitDomainEvent(tx, "invoice.written_off", {
      invoiceId: invoice.id,
      customerId: invoice.customerId,
      writtenOffCents: invoice.totalCents - paid,
      reason: input.reason,
    });
    return { eventId };
  });

  await forwardDomainEvent(outcome.eventId);
}

const adjustSchema = z.object({
  invoiceId: uuid,
  /** Magnitude of the credit in cents; the stored line is negative. */
  amountCents: z
    .number()
    .int("Credit must be whole cents")
    .positive("Credit must be more than R0.00"),
  reason: reasonSchema,
});
export type AdjustInvoiceInput = z.infer<typeof adjustSchema>;

/**
 * Credit part of an invoice: goodwill, a service-credit for downtime, or a
 * correction. Appends a negative `adjustment` line and lowers the total.
 * Nothing is deleted and the original lines stay on the document, so the
 * customer's invoice tells the whole story. A credit for the full
 * outstanding amount is refused when nothing has been paid, that is a void.
 */
export async function adjustInvoice(
  actor: Actor,
  rawInput: AdjustInvoiceInput
): Promise<void> {
  authorize(actor, "invoice.adjust");
  const input = adjustSchema.parse(rawInput);

  const outcome = await db.transaction(async (tx) => {
    const invoice = await lockedOpenInvoice(tx, input.invoiceId);
    const paid = await paidCentsFor(tx, invoice.id);
    const outstanding = outstandingCents(invoice.totalCents, paid);
    if (input.amountCents > outstanding) {
      throw new Error(
        `Credit exceeds the R${(outstanding / 100).toFixed(2)} still outstanding on this invoice`
      );
    }
    if (input.amountCents === outstanding && paid === 0) {
      throw new Error(
        "That credits the whole invoice. Void it or write it off instead."
      );
    }

    const newTotal = invoice.totalCents - input.amountCents;
    await tx.insert(invoiceLines).values({
      invoiceId: invoice.id,
      kind: "adjustment",
      description: `Credit: ${input.reason}`,
      amountCents: -input.amountCents,
      qty: 1,
    });
    const settled = paid >= newTotal;
    await tx
      .update(invoices)
      .set({
        subtotalCents: invoice.subtotalCents - input.amountCents,
        totalCents: newTotal,
        ...(settled ? { status: "paid" as const, paidAt: new Date() } : {}),
      })
      .where(eq(invoices.id, invoice.id));
    if (settled) {
      await clearPendingAttempts(tx, invoice.id, "invoice settled after credit");
    }

    await writeAudit(tx, {
      actor,
      action: "invoice.adjust",
      entity: "invoice",
      entityId: invoice.id,
      before: { totalCents: invoice.totalCents, status: invoice.status },
      after: {
        totalCents: newTotal,
        creditCents: input.amountCents,
        reason: input.reason,
        status: settled ? "paid" : invoice.status,
      },
    });
    const eventId = await emitDomainEvent(tx, "invoice.adjusted", {
      invoiceId: invoice.id,
      customerId: invoice.customerId,
      creditCents: input.amountCents,
      totalCents: newTotal,
      reason: input.reason,
    });
    return { invoice, settled, eventId };
  });

  await forwardDomainEvent(outcome.eventId);
  if (outcome.settled) {
    await maybeReactivateAfterSettlement(outcome.invoice.customerId);
  }
}

/** Row-locked fetch that refuses anything already closed out. */
async function lockedOpenInvoice(tx: Tx, invoiceId: string) {
  const [invoice] = await tx
    .select()
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1)
    .for("update");
  if (!invoice) throw new Error("Invoice not found");
  if (invoice.status === "paid") throw new Error("Invoice is already paid");
  if (invoice.status === "void") throw new Error("Invoice is already void");
  if (invoice.status === "written_off") {
    throw new Error("Invoice is already written off");
  }
  return invoice;
}

/**
 * Open or past-due invoices that have been sitting long enough for the §6.3
 * day-40 call: cancel the service or write the invoice off. The dunning
 * sweep only rings a bell, which disappears once read; this makes the same
 * decision a standing queue.
 */
export async function invoicesAwaitingDecision(
  decisionDay: number,
  today = todayInJohannesburg()
) {
  return db
    .select({ invoice: invoices, customer: customers, service: services })
    .from(invoices)
    .innerJoin(customers, eq(invoices.customerId, customers.id))
    .leftJoin(services, eq(invoices.serviceId, services.id))
    .where(
      and(
        inArray(invoices.status, ["open", "past_due"]),
        sql`${invoices.issueDate} <= (${today}::date - ${decisionDay}::int)`
      )
    )
    .orderBy(invoices.issueDate);
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
