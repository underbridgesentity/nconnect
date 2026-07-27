"use server";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { quotes, orders, customers } from "@/lib/db/schema";
import { buildCheckout } from "@/lib/payfast";

/**
 * Resume an unpaid quote acceptance.
 *
 * A customer who abandoned PayFast, or whose card was declined, already has an
 * order sitting at pending_payment. Without this they are locked out: the quote
 * shows an accepted order they never paid for and there is no way back to the
 * gateway. This rebuilds the same checkout for the same order, so the amount,
 * the reference and the tokenisation stay identical to the first attempt.
 */
export type ResumeResult =
  | { ok: true; actionUrl: string; fields: Record<string, string> }
  | { ok: false; error: string };

export async function resumeQuotePaymentAction(
  token: string
): Promise<ResumeResult> {
  try {
    const [quote] = await db
      .select()
      .from(quotes)
      .where(eq(quotes.shareToken, token))
      .limit(1);
    if (!quote) return { ok: false, error: "We could not find that quote" };
    if (!quote.acceptedOrderId) {
      return { ok: false, error: "This quote has not been accepted yet" };
    }

    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, quote.acceptedOrderId))
      .limit(1);
    if (!order) return { ok: false, error: "We could not find that order" };
    if (order.status !== "pending_payment") {
      return { ok: false, error: "This order is already paid, nothing to do" };
    }

    const [customer] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, order.customerId))
      .limit(1);

    const checkout = buildCheckout({
      paymentId: order.id,
      amountCents: order.totalCents,
      itemName: `Needd Connect order ${order.number}`,
      customerFirstName: customer?.firstName ?? undefined,
      customerLastName: customer?.lastName ?? undefined,
      customerEmail: customer?.email ?? undefined,
      tokenize: true,
    });
    return { ok: true, ...checkout };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "We could not reach the payment page",
    };
  }
}
