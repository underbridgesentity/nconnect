import { describe, it, expect } from "vitest";
import {
  tokenChargeDisposition,
  type ChargeAnswer,
} from "@/lib/domain/billing-engine";

/**
 * What to do about one answer from the card gateway, pure and database-free.
 *
 * The pivot is whether the customer's money moved. PayFast replying `ok` means
 * it did, and that stays true whether or not the reply carried a reference we
 * could read. Recording such a charge as a failure lost the money twice over:
 * nothing was banked, so the invoice stayed open, and the next dunning slot
 * debited the customer again for what had already been taken. So the rules
 * pinned down here are that a successful debit is never called a failure, is
 * always banked under some identifier, and is never left where an automatic
 * retry can reach it.
 */

const PAYMENT_ID = "inv:5f3d:1";

const decide = (answer: ChargeAnswer) =>
  tokenChargeDisposition({ answer, paymentId: PAYMENT_ID });

describe("tokenChargeDisposition", () => {
  it("banks a normal success under the gateway's own reference", () => {
    const decision = decide({ kind: "replied", ok: true, gatewayRef: "pf-99001" });
    expect(decision.result).toBe("success");
    expect(decision.bankUnder).toBe("pf-99001");
    expect(decision.attemptResult).toBe("success");
    expect(decision.exception).toBeNull();
    expect(decision.mayRecharge).toBe(true);
  });

  it("still calls a success a success when the reference is unreadable", () => {
    for (const gatewayRef of [undefined, "", "   "]) {
      const decision = decide({ kind: "replied", ok: true, gatewayRef });
      expect(decision.result).toBe("success");
      expect(decision.attemptResult).toBe("success");
    }
  });

  it("banks a reference-less success under the m_payment_id it was charged with", () => {
    // There is always an identifier: the one we sent PayFast, which is what an
    // operator reconciles against on their side.
    const decision = decide({ kind: "replied", ok: true });
    expect(decision.bankUnder).toBe(PAYMENT_ID);
    expect(decision.detail).toContain(PAYMENT_ID);
  });

  it("puts a reference-less success in front of a person", () => {
    const decision = decide({ kind: "replied", ok: true });
    expect(decision.exception).toBe("Card charge without a gateway reference");
  });

  it("takes a reference-less success off automatic charging", () => {
    // This is the bit that stops the customer being debited twice.
    expect(decide({ kind: "replied", ok: true }).mayRecharge).toBe(false);
  });

  it("never guesses when the gateway call itself threw", () => {
    const decision = decide({ kind: "errored", message: "socket hang up" });
    expect(decision.result).toBe("failed");
    expect(decision.bankUnder).toBeNull();
    expect(decision.attemptResult).toBe("failed");
    expect(decision.exception).toBe("Card charge outcome unknown");
    // The card may have been debited, so no automatic retry either.
    expect(decision.mayRecharge).toBe(false);
    expect(decision.detail).toContain("socket hang up");
  });

  it("leaves a clean decline on the dunning timeline", () => {
    const decision = decide({
      kind: "replied",
      ok: false,
      detail: "insufficient funds",
    });
    expect(decision.result).toBe("failed");
    expect(decision.bankUnder).toBeNull();
    expect(decision.attemptResult).toBe("failed");
    expect(decision.exception).toBeNull();
    // No money moved, so the next slot in the timeline should try again.
    expect(decision.mayRecharge).toBe(true);
    expect(decision.detail).toBe("insufficient funds");
  });

  it("still records a decline the gateway gave no reason for", () => {
    const decision = decide({ kind: "replied", ok: false });
    expect(decision.detail.length).toBeGreaterThan(0);
  });

  it("never reports a debit as failed, and never leaves one unbanked", () => {
    const debited: ChargeAnswer[] = [
      { kind: "replied", ok: true, gatewayRef: "pf-1" },
      { kind: "replied", ok: true, gatewayRef: "" },
      { kind: "replied", ok: true },
    ];
    for (const answer of debited) {
      const decision = decide(answer);
      expect(decision.result).toBe("success");
      expect(decision.bankUnder).not.toBeNull();
    }
  });

  it("never lets an outcome we are unsure of be charged again automatically", () => {
    const unsure: ChargeAnswer[] = [
      { kind: "errored", message: "timeout" },
      { kind: "replied", ok: true },
    ];
    for (const answer of unsure) {
      const decision = decide(answer);
      expect(decision.mayRecharge).toBe(false);
      expect(decision.exception).not.toBeNull();
    }
  });
});
