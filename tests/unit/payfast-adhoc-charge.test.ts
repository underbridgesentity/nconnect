import { describe, it, expect } from "vitest";
import {
  DERIVED_GATEWAY_REF_PREFIX,
  derivedGatewayRef,
  isDerivedGatewayRef,
  merchantRefFromDerived,
  readAdhocChargeResponse,
} from "@/lib/payfast";

/**
 * Every recurring charge has to bank under a reference of its own.
 *
 * `payments.gateway_ref` is unique and is the sole idempotency key of the
 * settlement path, so two charges sharing a reference means the second is
 * swallowed as a replay: the customer is debited, the invoice stays open, and
 * nothing complains. That is exactly what happened when the ad-hoc reply's
 * `{"data":{"response":true}}` was read as a string, because `typeof true` is
 * "boolean", not "object", and the fallback branch produced the literal
 * reference "true" for every successful charge on the platform.
 *
 * These tests pin the reading of each documented reply shape, and the one
 * property that matters across all of them: a charged card never yields a
 * constant.
 */

const PAYMENT_ID = "inv:019fa58e-2ad3-7a28-876c-dc21351933bc:2";

describe("derivedGatewayRef", () => {
  it("is namespaced so it can never be mistaken for a PayFast reference", () => {
    // Real pf_payment_id values are plain digits.
    const ref = derivedGatewayRef(PAYMENT_ID);
    expect(ref.startsWith(DERIVED_GATEWAY_REF_PREFIX)).toBe(true);
    expect(/^\d+$/.test(ref)).toBe(false);
    expect(isDerivedGatewayRef(ref)).toBe(true);
    expect(isDerivedGatewayRef("1089250")).toBe(false);
  });

  it("carries the m_payment_id an operator reconciles against", () => {
    expect(derivedGatewayRef(PAYMENT_ID)).toContain(PAYMENT_ID);
    expect(merchantRefFromDerived(derivedGatewayRef(PAYMENT_ID))).toBe(
      PAYMENT_ID
    );
    expect(merchantRefFromDerived("1089250")).toBeNull();
  });

  it("is unique per invoice and per attempt", () => {
    const refs = new Set([
      derivedGatewayRef("inv:a:1"),
      derivedGatewayRef("inv:a:2"),
      derivedGatewayRef("inv:b:1"),
    ]);
    expect(refs.size).toBe(3);
  });

  it("does not namespace a reference twice", () => {
    const once = derivedGatewayRef(PAYMENT_ID);
    expect(derivedGatewayRef(once)).toBe(once);
  });

  it("refuses to derive anything from a blank payment id", () => {
    // A blank reference is no idempotency key at all, so it must not exist.
    expect(() => derivedGatewayRef("   ")).toThrow();
  });
});

describe("readAdhocChargeResponse", () => {
  const read = (body: unknown) => readAdhocChargeResponse(body, PAYMENT_ID);

  it("never returns a constant for the documented success body", () => {
    // {"code":200,"status":"success","data":{"response":true}}
    const first = readAdhocChargeResponse(
      { code: 200, status: "success", data: { response: true, message: "ok" } },
      "inv:a:1"
    );
    const second = readAdhocChargeResponse(
      { code: 200, status: "success", data: { response: true, message: "ok" } },
      "inv:a:2"
    );
    expect(first.kind).toBe("charged");
    expect(second.kind).toBe("charged");
    if (first.kind !== "charged" || second.kind !== "charged") return;
    expect(first.gatewayRef).not.toBe(second.gatewayRef);
    expect(first.gatewayRef).not.toBe("true");
    expect(first.derived).toBe(true);
  });

  it("uses PayFast's own transaction id when the reply names one", () => {
    const reading = read({
      code: 200,
      status: "success",
      data: { response: { pf_payment_id: 1089250, amount_gross: "754.00" } },
    });
    expect(reading).toEqual({
      kind: "charged",
      gatewayRef: "1089250",
      derived: false,
    });
  });

  it("takes the transaction id when it arrives in place of the boolean", () => {
    expect(read({ code: 200, status: "success", data: { response: 1089250 } }))
      .toEqual({ kind: "charged", gatewayRef: "1089250", derived: false });
    expect(read({ code: 200, status: "success", data: { response: "1089250" } }))
      .toEqual({ kind: "charged", gatewayRef: "1089250", derived: false });
  });

  it("derives a reference when the object response names no transaction", () => {
    const reading = read({
      code: 200,
      status: "success",
      data: { response: { message: "Charge accepted" } },
    });
    expect(reading).toEqual({
      kind: "charged",
      gatewayRef: derivedGatewayRef(PAYMENT_ID),
      derived: true,
    });
  });

  it("derives a reference when a success envelope carries no response", () => {
    expect(read({ code: 200, status: "success", data: { message: "ok" } })).toEqual(
      { kind: "charged", gatewayRef: derivedGatewayRef(PAYMENT_ID), derived: true }
    );
  });

  it("reads a failed envelope as a decline, whatever the HTTP status was", () => {
    const reading = read({
      code: 400,
      status: "failed",
      data: { response: false, message: "merchant does not have permission" },
    });
    expect(reading.kind).toBe("declined");
    if (reading.kind !== "declined") return;
    expect(reading.detail).toContain("permission");
  });

  it("reads response false as a decline even under a success envelope", () => {
    expect(read({ code: 200, status: "success", data: { response: false } }).kind)
      .toBe("declined");
    expect(read({ data: { response: "false" } }).kind).toBe("declined");
  });

  it("calls an unreadable reply unknown rather than a decline", () => {
    // A decline tells the timeline to try again, which would debit a customer
    // who may already have paid. Silence is never a decline.
    for (const body of [null, undefined, "", "<html>502</html>", 7, []]) {
      expect(read(body).kind).toBe("unknown");
    }
    expect(read({ data: {} }).kind).toBe("unknown");
  });

  it("banks each attempt on one invoice under its own reference", () => {
    // The failure this guards against: charge one banks, every later charge is
    // swallowed as a duplicate of it and the customer is debited for nothing.
    const success = { code: 200, status: "success", data: { response: true } };
    const refs = [1, 2, 3].map((attempt) => {
      const reading = readAdhocChargeResponse(success, `inv:abc:${attempt}`);
      return reading.kind === "charged" ? reading.gatewayRef : "";
    });
    expect(new Set(refs).size).toBe(3);
  });
});
