import { describe, it, expect } from "vitest";
import {
  isPastValidUntil,
  isQuoteExpired,
  type OrderStatus,
  type QuoteOrderRef,
} from "@/lib/domain/quotes";

/**
 * Whether a quote is dead.
 *
 * Expiry is a date, acceptance is an event, and the date must not overrule the
 * event. A customer sitting at PayFast has already accepted: the order is
 * reserved against the quote, `createOrderFromQuote` refuses to raise a second
 * one, and the resume-payment button rebuilds their checkout from it. Calling
 * that quote expired because the validity date rolled over while they were on
 * the payment page locks them out of a payment they are in the middle of
 * making, and the nightly `expireQuotes` sweep has always known that. These
 * tests hold the read side to the same rule, in one place, so a screen cannot
 * quietly disagree with the sweep again.
 */

const DAY = 86_400_000;
const yesterday = () => new Date(Date.now() - DAY);
const nextWeek = () => new Date(Date.now() + 7 * DAY);

function quote(overrides: Partial<{ status: string; expiresAt: Date | null }> = {}) {
  return { status: "sent", expiresAt: nextWeek(), ...overrides };
}

const midCheckout: QuoteOrderRef = { status: "pending_payment" };

describe("isQuoteExpired", () => {
  it("is alive while the validity date is still ahead", () => {
    expect(isQuoteExpired(quote())).toBe(false);
  });

  it("is dead once the validity date has passed", () => {
    expect(isQuoteExpired(quote({ expiresAt: yesterday() }))).toBe(true);
  });

  it("is dead once the sweep has marked it expired", () => {
    expect(isQuoteExpired(quote({ status: "expired", expiresAt: nextWeek() }))).toBe(
      true
    );
  });

  it("never expires a quote with no validity date at all", () => {
    expect(isQuoteExpired(quote({ expiresAt: null }))).toBe(false);
  });

  it("keeps a lapsed quote alive while the customer is at PayFast", () => {
    // The bug this rule exists for: the date rolls over while the customer is
    // on the payment page, and the quote they are paying for reads "expired".
    expect(isQuoteExpired(quote({ expiresAt: yesterday() }), midCheckout)).toBe(
      false
    );
  });

  it("lets the order outrank a status the sweep managed to write", () => {
    // `expireQuotes` skips mid-checkout quotes, so this should not arise. If a
    // stale status ever did land on one, the live order is still the truth and
    // the customer must not be locked out of paying it.
    expect(
      isQuoteExpired(
        quote({ status: "expired", expiresAt: yesterday() }),
        midCheckout
      )
    ).toBe(false);
  });

  it("expires a lapsed quote again once the order stops being live", () => {
    // Every other order status is a settled outcome. The quote is then judged
    // on its date exactly as it was before the customer ever went to PayFast.
    const settled: OrderStatus[] = ["paid", "processing", "fulfilled", "cancelled"];
    for (const status of settled) {
      expect(isQuoteExpired(quote({ expiresAt: yesterday() }), { status })).toBe(
        true
      );
    }
  });

  it("does not resurrect a lapsed quote just because an order exists", () => {
    // A cancelled order is the case that matters: nothing was charged, and the
    // quote is as dead as its date says.
    expect(
      isQuoteExpired(quote({ expiresAt: yesterday() }), { status: "cancelled" })
    ).toBe(true);
  });

  it("reads an in-date quote the same way with or without an order", () => {
    for (const order of [null, midCheckout, { status: "paid" as OrderStatus }]) {
      expect(isQuoteExpired(quote(), order)).toBe(false);
    }
  });
});

describe("isPastValidUntil", () => {
  it("reports the calendar on its own, whatever the order is doing", () => {
    // The detail screen still needs this to say "even though the validity date
    // passed on 12 July" next to the mid-checkout notice.
    const lapsed = quote({ expiresAt: yesterday() });
    expect(isPastValidUntil(lapsed)).toBe(true);
    expect(isQuoteExpired(lapsed, midCheckout)).toBe(false);
  });

  it("agrees with isQuoteExpired whenever there is no order", () => {
    for (const q of [
      quote(),
      quote({ expiresAt: yesterday() }),
      quote({ status: "expired" }),
      quote({ expiresAt: null }),
    ]) {
      expect(isQuoteExpired(q)).toBe(isPastValidUntil(q));
    }
  });
});
