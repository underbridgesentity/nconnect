import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { invoices, payments } from "@/lib/db/schema";

/**
 * What a customer actually owes.
 *
 * `recordManualPayment` deliberately leaves an invoice open when a payment
 * only partly covers it, and invoices carry no amount_paid column. Summing
 * `total_cents` over open invoices therefore overstates the balance for
 * anyone who has part-paid, and the pay link would charge the full amount
 * again. Every figure on this surface is total minus completed payments,
 * in integer cents.
 */

export type PaidSummary = { paidCents: number; lastPaymentAt: Date | null };

export type InvoiceWithBalance = {
  invoice: typeof invoices.$inferSelect;
  paidCents: number;
  balanceCents: number;
  lastPaymentAt: Date | null;
  /** True when something has been paid but the invoice is not settled. */
  partiallyPaid: boolean;
};

/** Completed payments per invoice for one customer, keyed by invoice id. */
export async function paidCentsByInvoice(
  customerId: string
): Promise<Map<string, PaidSummary>> {
  const rows = await db
    .select({
      invoiceId: payments.invoiceId,
      paidCents: sql<number>`coalesce(sum(${payments.amountCents}), 0)::int`,
      lastPaymentAt: sql<Date | null>`max(${payments.createdAt})`,
    })
    .from(payments)
    .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
    .where(
      and(
        eq(invoices.customerId, customerId),
        eq(payments.status, "complete")
      )
    )
    .groupBy(payments.invoiceId);

  return new Map(
    rows.map((r) => [
      r.invoiceId,
      {
        paidCents: Number(r.paidCents ?? 0),
        lastPaymentAt: r.lastPaymentAt ? new Date(r.lastPaymentAt) : null,
      },
    ])
  );
}

/** Attach the balance to an invoice row. */
export function withBalance(
  invoice: typeof invoices.$inferSelect,
  paid: PaidSummary | undefined
): InvoiceWithBalance {
  const paidCents = paid?.paidCents ?? 0;
  const balanceCents = Math.max(0, invoice.totalCents - paidCents);
  return {
    invoice,
    paidCents,
    balanceCents,
    lastPaymentAt: paid?.lastPaymentAt ?? null,
    partiallyPaid: paidCents > 0 && balanceCents > 0,
  };
}

export const OPEN_STATUSES = ["open", "past_due"] as const;

export function isOpen(invoice: typeof invoices.$inferSelect): boolean {
  return (OPEN_STATUSES as readonly string[]).includes(invoice.status);
}
