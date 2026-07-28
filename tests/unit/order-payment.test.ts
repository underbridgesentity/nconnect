import { describe, it, expect } from "vitest";
import { orderPaymentOutcome } from "@/lib/domain/orders";
import { formatCents } from "@/lib/money";

/**
 * The settlement rule for one order payment, pure and database-free. It is the
 * order-side twin of `gatewayPaymentOutcome` and follows the same law.
 *
 * The thing worth pinning down is that by the time this runs the card has
 * already been debited. Refusing money does not hand it back to the customer,
 * it only deletes our record of having taken it, so the only payment refused
 * here is one where nothing moved. Everything else is banked: money that
 * covers the order settles it, money that falls short settles nothing because
 * half a checkout is not a service anybody can provision, and money that lands
 * on an order already settled belongs to no line on it. The last two are still
 * recorded, and raised for a person.
 */

type Outcome = ReturnType<typeof orderPaymentOutcome>;

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

// A real checkout: R764.00 plan + router, the M2 fixture amount.
const TOTAL = 76400;

describe("orderPaymentOutcome", () => {
  it("settles a checkout paid in full in one go", () => {
    const outcome = expectAccepted(
      orderPaymentOutcome({
        status: "pending_payment",
        totalCents: TOTAL,
        alreadyPaidCents: 0,
        amountCents: TOTAL,
      })
    );
    expect(outcome.disposition).toBe("applied");
    expect(outcome.paidTotalCents).toBe(TOTAL);
    expect(outcome.unallocatedCents).toBe(0);
    expect(outcome.settles).toBe(true);
  });

  it("banks a second confirmed debit on an order already paid", () => {
    // The finding this rule exists for: two tabs, or an impatient retry. The
    // customer has been charged twice and both charges are real, so the second
    // one is recorded rather than discarded as "already paid".
    const outcome = expectAccepted(
      orderPaymentOutcome({
        status: "paid",
        totalCents: TOTAL,
        alreadyPaidCents: TOTAL,
        amountCents: TOTAL,
      })
    );
    expect(outcome.disposition).toBe("unallocated");
    expect(outcome.unallocatedCents).toBe(TOTAL);
    expect(outcome.paidTotalCents).toBe(TOTAL * 2);
    // The order is settled already, so this payment settles nothing.
    expect(outcome.settles).toBe(false);
    expect(outcome.note).toContain(formatCents(TOTAL));
  });

  it("banks money that lands on an order being processed or fulfilled", () => {
    for (const status of ["processing", "fulfilled"] as const) {
      const outcome = expectAccepted(
        orderPaymentOutcome({
          status,
          totalCents: TOTAL,
          alreadyPaidCents: TOTAL,
          amountCents: 25000,
        })
      );
      expect(outcome.disposition).toBe("unallocated");
      expect(outcome.unallocatedCents).toBe(25000);
      expect(outcome.settles).toBe(false);
    }
  });

  it("banks a short payment without settling the order", () => {
    // Nothing is provisioned on a part-paid checkout, and nothing is thrown
    // away either: the money is recorded and somebody decides what happens.
    const outcome = expectAccepted(
      orderPaymentOutcome({
        status: "pending_payment",
        totalCents: TOTAL,
        alreadyPaidCents: 0,
        amountCents: 30000,
      })
    );
    expect(outcome.disposition).toBe("unallocated");
    expect(outcome.unallocatedCents).toBe(30000);
    expect(outcome.paidTotalCents).toBe(30000);
    expect(outcome.settles).toBe(false);
    // The operator is told what is missing, in rands, not in cents.
    expect(outcome.note).toContain(formatCents(46400));
  });

  it("settles when a second payment brings the balance up to the total", () => {
    const first = expectAccepted(
      orderPaymentOutcome({
        status: "pending_payment",
        totalCents: TOTAL,
        alreadyPaidCents: 0,
        amountCents: 30000,
      })
    );
    expect(first.settles).toBe(false);
    const second = expectAccepted(
      orderPaymentOutcome({
        status: "pending_payment",
        totalCents: TOTAL,
        alreadyPaidCents: first.paidTotalCents,
        amountCents: 46400,
      })
    );
    expect(second.disposition).toBe("applied");
    expect(second.paidTotalCents).toBe(TOTAL);
    expect(second.unallocatedCents).toBe(0);
    expect(second.settles).toBe(true);
  });

  it("still settles when the last cent arrives on its own", () => {
    const outcome = expectAccepted(
      orderPaymentOutcome({
        status: "pending_payment",
        totalCents: TOTAL,
        alreadyPaidCents: TOTAL - 1,
        amountCents: 1,
      })
    );
    expect(outcome.paidTotalCents).toBe(TOTAL);
    expect(outcome.settles).toBe(true);
    expect(outcome.unallocatedCents).toBe(0);
  });

  it("settles an overpayment and flags the change", () => {
    const outcome = expectAccepted(
      orderPaymentOutcome({
        status: "pending_payment",
        totalCents: TOTAL,
        alreadyPaidCents: 0,
        amountCents: TOTAL + 5000,
      })
    );
    // The customer was charged R814, so R814 is what we record. The order is
    // covered, and the R50 over is somebody's job to allocate or refund.
    expect(outcome.disposition).toBe("overpaid");
    expect(outcome.paidTotalCents).toBe(TOTAL + 5000);
    expect(outcome.unallocatedCents).toBe(5000);
    expect(outcome.settles).toBe(true);
    expect(outcome.note).toContain(formatCents(5000));
  });

  it("honours a payment that covers an order we had already retired", () => {
    // The customer had the PayFast page open when the stale order was
    // cancelled. The money covers this order, so this order is what it pays.
    const outcome = expectAccepted(
      orderPaymentOutcome({
        status: "cancelled",
        totalCents: TOTAL,
        alreadyPaidCents: 0,
        amountCents: TOTAL,
      })
    );
    expect(outcome.disposition).toBe("applied");
    expect(outcome.settles).toBe(true);
  });

  it("does not revive a cancelled order with money that falls short of it", () => {
    const outcome = expectAccepted(
      orderPaymentOutcome({
        status: "cancelled",
        totalCents: TOTAL,
        alreadyPaidCents: 0,
        amountCents: 70000,
      })
    );
    expect(outcome.disposition).toBe("unallocated");
    expect(outcome.unallocatedCents).toBe(70000);
    expect(outcome.settles).toBe(false);
  });

  it("refuses only a zero or negative amount, where no money moved", () => {
    for (const amountCents of [0, -1, -76400]) {
      expectRejected(
        orderPaymentOutcome({
          status: "pending_payment",
          totalCents: TOTAL,
          alreadyPaidCents: 0,
          amountCents,
        })
      );
    }
  });

  it("always says something a person can act on when money is left over", () => {
    const cases = [
      { status: "pending_payment" as const, alreadyPaidCents: 0, amountCents: 30000 },
      { status: "pending_payment" as const, alreadyPaidCents: 0, amountCents: TOTAL + 1 },
      { status: "paid" as const, alreadyPaidCents: TOTAL, amountCents: TOTAL },
    ];
    for (const c of cases) {
      const outcome = expectAccepted(
        orderPaymentOutcome({ totalCents: TOTAL, ...c })
      );
      expect(outcome.unallocatedCents).toBeGreaterThan(0);
      expect(outcome.note ?? "").not.toBe("");
    }
  });

  it("never reports money it has not accounted for", () => {
    // Whatever the order state, applied plus unallocated equals the amount
    // charged. That identity is what stops money vanishing between branches.
    const statuses = [
      "pending_payment",
      "paid",
      "processing",
      "fulfilled",
      "cancelled",
    ] as const;
    for (const status of statuses) {
      for (const alreadyPaidCents of [0, 30000, TOTAL]) {
        for (const amountCents of [1, 30000, TOTAL, TOTAL + 1]) {
          const outcome = expectAccepted(
            orderPaymentOutcome({
              status,
              totalCents: TOTAL,
              alreadyPaidCents,
              amountCents,
            })
          );
          const appliedCents = amountCents - outcome.unallocatedCents;
          expect(appliedCents).toBeGreaterThanOrEqual(0);
          expect(appliedCents + outcome.unallocatedCents).toBe(amountCents);
          expect(outcome.paidTotalCents).toBe(alreadyPaidCents + amountCents);
          // An order only settles when the money banked against it covers it,
          // and only from a state a payment is allowed to settle.
          if (outcome.settles) {
            expect(outcome.paidTotalCents).toBeGreaterThanOrEqual(TOTAL);
            expect(["pending_payment", "cancelled"]).toContain(status);
          }
          // Nothing is ever half applied: a payment either settles the order
          // or waits in full for a person.
          if (!outcome.settles) {
            expect(outcome.unallocatedCents).toBe(amountCents);
          }
        }
      }
    }
  });
});
