import { describe, it, expect } from "vitest";
import { gatewayPaymentOutcome } from "@/lib/domain/billing-engine";
import { formatCents } from "@/lib/money";

/**
 * The settlement rule for one gateway payment, pure and database-free.
 *
 * The thing worth pinning down is the asymmetry: money that arrives for less
 * than the invoice is banked and the invoice stays open, money that arrives
 * for more is refused outright, because payment rows are never deleted (§16.4)
 * and an over-allocation would be permanent.
 */

type Outcome = ReturnType<typeof gatewayPaymentOutcome>;

/** Narrows, and reports the refusal reason when a case unexpectedly fails. */
function expectAccepted(outcome: Outcome) {
  if (!outcome.accepted) {
    throw new Error(`expected the payment to be accepted, got: ${outcome.reason}`);
  }
  return outcome;
}

function expectRejected(outcome: Outcome) {
  if (outcome.accepted) {
    throw new Error(
      `expected the payment to be refused, it was accepted with ` +
        `paidTotalCents=${outcome.paidTotalCents}`
    );
  }
  expect(outcome.reason.length).toBeGreaterThan(0);
  return outcome;
}

// A real invoice shape: R764.00 plan + router, the M2 fixture amount.
const TOTAL = 76400;

describe("gatewayPaymentOutcome", () => {
  it("settles an invoice paid in full in one go", () => {
    const outcome = expectAccepted(
      gatewayPaymentOutcome({
        totalCents: TOTAL,
        alreadyPaidCents: 0,
        amountCents: TOTAL,
      })
    );
    expect(outcome.outstandingCents).toBe(TOTAL);
    expect(outcome.paidTotalCents).toBe(TOTAL);
    expect(outcome.settles).toBe(true);
  });

  it("banks a part payment and leaves the invoice open", () => {
    const outcome = expectAccepted(
      gatewayPaymentOutcome({
        totalCents: TOTAL,
        alreadyPaidCents: 0,
        amountCents: 30000,
      })
    );
    expect(outcome.outstandingCents).toBe(TOTAL);
    expect(outcome.paidTotalCents).toBe(30000);
    expect(outcome.settles).toBe(false);
  });

  it("settles when a second part payment completes the total", () => {
    const first = expectAccepted(
      gatewayPaymentOutcome({
        totalCents: TOTAL,
        alreadyPaidCents: 0,
        amountCents: 30000,
      })
    );
    const second = expectAccepted(
      gatewayPaymentOutcome({
        totalCents: TOTAL,
        alreadyPaidCents: first.paidTotalCents,
        amountCents: TOTAL - first.paidTotalCents,
      })
    );
    // What is left to pay, not the invoice total, once part of it is banked.
    expect(second.outstandingCents).toBe(46400);
    expect(second.paidTotalCents).toBe(TOTAL);
    expect(second.settles).toBe(true);
  });

  it("still settles when the last cent arrives on its own", () => {
    const outcome = expectAccepted(
      gatewayPaymentOutcome({
        totalCents: TOTAL,
        alreadyPaidCents: TOTAL - 1,
        amountCents: 1,
      })
    );
    expect(outcome.outstandingCents).toBe(1);
    expect(outcome.paidTotalCents).toBe(TOTAL);
    expect(outcome.settles).toBe(true);
  });

  it("refuses an overpayment on an untouched invoice", () => {
    const outcome = expectRejected(
      gatewayPaymentOutcome({
        totalCents: TOTAL,
        alreadyPaidCents: 0,
        amountCents: TOTAL + 1,
      })
    );
    // The customer needs both numbers to see why it bounced, written the way
    // the rest of the app writes money (en-ZA, so a comma decimal mark).
    expect(outcome.reason).toContain(formatCents(TOTAL + 1));
    expect(outcome.reason).toContain(formatCents(TOTAL));
  });

  it("refuses an overpayment measured against the balance, not the total", () => {
    // R300 is well under the R764 total but a cent over the R464 still owed.
    expectRejected(
      gatewayPaymentOutcome({
        totalCents: TOTAL,
        alreadyPaidCents: 30000,
        amountCents: 46401,
      })
    );
  });

  it("refuses a payment against an invoice with nothing outstanding", () => {
    const outcome = expectRejected(
      gatewayPaymentOutcome({
        totalCents: TOTAL,
        alreadyPaidCents: TOTAL,
        amountCents: 1000,
      })
    );
    expect(outcome.reason).toContain("Nothing is outstanding");
  });

  it("refuses a zero or negative amount", () => {
    for (const amountCents of [0, -1, -76400]) {
      expectRejected(
        gatewayPaymentOutcome({
          totalCents: TOTAL,
          alreadyPaidCents: 0,
          amountCents,
        })
      );
    }
  });
});
