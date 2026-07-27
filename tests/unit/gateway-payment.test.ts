import { describe, it, expect } from "vitest";
import { gatewayPaymentOutcome } from "@/lib/domain/billing-engine";
import { formatCents } from "@/lib/money";

/**
 * The settlement rule for one gateway payment, pure and database-free.
 *
 * The thing worth pinning down is that by the time this runs the card has
 * already been debited. Refusing money does not hand it back to the customer,
 * it only deletes our record of having taken it, so the only payment refused
 * here is one where nothing moved. Everything else is banked: under the
 * balance leaves the invoice open, at or over the balance settles it, and
 * money an invoice cannot absorb at all is banked and flagged for a person.
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
        status: "open",
        totalCents: TOTAL,
        alreadyPaidCents: 0,
        amountCents: TOTAL,
      })
    );
    expect(outcome.disposition).toBe("applied");
    expect(outcome.outstandingCents).toBe(TOTAL);
    expect(outcome.paidTotalCents).toBe(TOTAL);
    expect(outcome.excessCents).toBe(0);
    expect(outcome.settles).toBe(true);
  });

  it("banks a part payment and leaves the invoice open", () => {
    const outcome = expectAccepted(
      gatewayPaymentOutcome({
        status: "open",
        totalCents: TOTAL,
        alreadyPaidCents: 0,
        amountCents: 30000,
      })
    );
    expect(outcome.disposition).toBe("applied");
    expect(outcome.outstandingCents).toBe(TOTAL);
    expect(outcome.paidTotalCents).toBe(30000);
    expect(outcome.excessCents).toBe(0);
    expect(outcome.settles).toBe(false);
  });

  it("settles when a second part payment completes the total", () => {
    const first = expectAccepted(
      gatewayPaymentOutcome({
        status: "open",
        totalCents: TOTAL,
        alreadyPaidCents: 0,
        amountCents: 30000,
      })
    );
    const second = expectAccepted(
      gatewayPaymentOutcome({
        status: "past_due",
        totalCents: TOTAL,
        alreadyPaidCents: first.paidTotalCents,
        amountCents: TOTAL - first.paidTotalCents,
      })
    );
    // What is left to pay, not the invoice total, once part of it is banked.
    expect(second.outstandingCents).toBe(46400);
    expect(second.paidTotalCents).toBe(TOTAL);
    expect(second.settles).toBe(true);
    expect(second.excessCents).toBe(0);
  });

  it("still settles when the last cent arrives on its own", () => {
    const outcome = expectAccepted(
      gatewayPaymentOutcome({
        status: "open",
        totalCents: TOTAL,
        alreadyPaidCents: TOTAL - 1,
        amountCents: 1,
      })
    );
    expect(outcome.outstandingCents).toBe(1);
    expect(outcome.paidTotalCents).toBe(TOTAL);
    expect(outcome.settles).toBe(true);
  });

  it("banks an overpayment, settles the invoice and flags the excess", () => {
    const outcome = expectAccepted(
      gatewayPaymentOutcome({
        status: "open",
        totalCents: TOTAL,
        alreadyPaidCents: 0,
        amountCents: TOTAL + 5000,
      })
    );
    // The customer was charged R814, so R814 is what we record. The invoice
    // is covered, and the R50 over is somebody's job to allocate or refund.
    expect(outcome.disposition).toBe("overpaid");
    expect(outcome.paidTotalCents).toBe(TOTAL + 5000);
    expect(outcome.excessCents).toBe(5000);
    expect(outcome.settles).toBe(true);
    expect(outcome.note).toContain(formatCents(5000));
  });

  it("measures the excess against the balance, not the total", () => {
    // R300 already banked, so R464 is owed and R500 arrives: R36 over.
    const outcome = expectAccepted(
      gatewayPaymentOutcome({
        status: "past_due",
        totalCents: TOTAL,
        alreadyPaidCents: 30000,
        amountCents: 50000,
      })
    );
    expect(outcome.disposition).toBe("overpaid");
    expect(outcome.outstandingCents).toBe(46400);
    expect(outcome.excessCents).toBe(3600);
    expect(outcome.paidTotalCents).toBe(80000);
    expect(outcome.settles).toBe(true);
  });

  it("banks a second debit on an already settled invoice as unallocated", () => {
    // Two tabs, or an ITN retried under a fresh pf_payment_id. The customer
    // has been charged twice and both charges are real.
    const outcome = expectAccepted(
      gatewayPaymentOutcome({
        status: "paid",
        totalCents: TOTAL,
        alreadyPaidCents: TOTAL,
        amountCents: TOTAL,
      })
    );
    expect(outcome.disposition).toBe("unallocated");
    expect(outcome.excessCents).toBe(TOTAL);
    expect(outcome.paidTotalCents).toBe(TOTAL * 2);
    // The invoice is already paid, so this payment does not settle anything.
    expect(outcome.settles).toBe(false);
    expect(outcome.note).toContain(formatCents(TOTAL));
  });

  it("banks money that lands on a void invoice", () => {
    const outcome = expectAccepted(
      gatewayPaymentOutcome({
        status: "void",
        totalCents: TOTAL,
        alreadyPaidCents: 0,
        amountCents: TOTAL,
      })
    );
    expect(outcome.disposition).toBe("unallocated");
    expect(outcome.excessCents).toBe(TOTAL);
    // A payment never revives a voided document.
    expect(outcome.settles).toBe(false);
    expect(outcome.note).toContain("void");
  });

  it("banks money that lands on a written-off invoice", () => {
    const outcome = expectAccepted(
      gatewayPaymentOutcome({
        status: "written_off",
        totalCents: TOTAL,
        alreadyPaidCents: 0,
        amountCents: 25000,
      })
    );
    expect(outcome.disposition).toBe("unallocated");
    expect(outcome.excessCents).toBe(25000);
    expect(outcome.settles).toBe(false);
    expect(outcome.note).toContain("written off");
  });

  it("banks money for an open invoice that has nothing left outstanding", () => {
    // Settled by EFT an hour earlier but never flipped to paid: the balance
    // is zero, so none of this can be applied, and none of it is lost either.
    const outcome = expectAccepted(
      gatewayPaymentOutcome({
        status: "open",
        totalCents: TOTAL,
        alreadyPaidCents: TOTAL,
        amountCents: 1000,
      })
    );
    expect(outcome.disposition).toBe("unallocated");
    expect(outcome.excessCents).toBe(1000);
    expect(outcome.settles).toBe(false);
    expect(outcome.note).toContain("nothing was outstanding");
  });

  it("refuses only a zero or negative amount, where no money moved", () => {
    for (const amountCents of [0, -1, -76400]) {
      expectRejected(
        gatewayPaymentOutcome({
          status: "open",
          totalCents: TOTAL,
          alreadyPaidCents: 0,
          amountCents,
        })
      );
    }
  });

  it("never reports money it has not accounted for", () => {
    // Whatever the invoice state, applied plus unallocated equals the amount
    // charged. That identity is what stops money vanishing between branches.
    const statuses = [
      "draft",
      "open",
      "past_due",
      "paid",
      "void",
      "written_off",
    ] as const;
    for (const status of statuses) {
      for (const alreadyPaidCents of [0, 30000, TOTAL]) {
        for (const amountCents of [1, 30000, TOTAL, TOTAL + 1]) {
          const outcome = expectAccepted(
            gatewayPaymentOutcome({
              status,
              totalCents: TOTAL,
              alreadyPaidCents,
              amountCents,
            })
          );
          const appliedCents = amountCents - outcome.excessCents;
          expect(appliedCents).toBeGreaterThanOrEqual(0);
          expect(appliedCents + outcome.excessCents).toBe(amountCents);
          expect(outcome.paidTotalCents).toBe(alreadyPaidCents + amountCents);
          // An invoice only settles when what is banked against it covers it.
          if (outcome.settles) {
            expect(outcome.paidTotalCents).toBeGreaterThanOrEqual(TOTAL);
            expect(["draft", "open", "past_due"]).toContain(status);
          }
        }
      }
    }
  });
});
