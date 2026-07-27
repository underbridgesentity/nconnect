import { describe, it, expect } from "vitest";
import { signPayload, verifyItnSignature } from "@/lib/payfast";

/**
 * The signature must be byte-identical to PHP's urlencode()-based reference
 * implementation from PayFast's docs. The expected hash below was computed
 * with an independent PHP-urlencode implementation (see PROGRESS.md M2).
 */
describe("payfast signature", () => {
  const fields: [string, string][] = [
    ["merchant_id", "10000100"],
    ["merchant_key", "46f0cd694581a"],
    ["return_url", "https://needdconnect.co.za/signup/success?ref=abc-123"],
    ["name_first", "Thandi"],
    ["item_name", "Needd Connect order NC-2026-00001 (LTE) + router!"],
    ["amount", "764.00"],
  ];

  it("matches the PHP urlencode reference (with passphrase)", () => {
    expect(signPayload(fields, "jt7NOE43FZPn")).toBe(
      "6d69aa1ae0bea004bf94c4f07c311f58"
    );
  });

  it("skips empty values and omits absent passphrase", () => {
    const withEmpty: [string, string][] = [...fields, ["custom_str1", ""]];
    expect(signPayload(withEmpty, "jt7NOE43FZPn")).toBe(
      "6d69aa1ae0bea004bf94c4f07c311f58"
    );
    expect(signPayload(fields, "")).not.toBe(
      "6d69aa1ae0bea004bf94c4f07c311f58"
    );
  });

  it("percent-encodes passphrases containing reserved characters", () => {
    // Real passphrases may contain '/', '+' and other reserved bytes. PHP's
    // urlencode escapes them (uppercase hex); a raw passphrase would silently
    // produce a signature PayFast rejects with "signature does not match".
    const withSlash: [string, string][] = [
      ["merchant_id", "16240038"],
      ["return_url", "https://needdconnect.co.za/signup/success?ref=abc-123"],
      ["item_name", "Needd Connect LTE + router"],
      ["amount", "764.00"],
    ];
    expect(signPayload(withSlash, "_/A1b2-test")).toBe(
      "2fa475b563f624af96f1e6d57b629d61"
    );
  });

  it("verifies an ITN payload round-trip", () => {
    process.env.PAYFAST_MERCHANT_ID = "10000100";
    process.env.PAYFAST_MERCHANT_KEY = "46f0cd694581a";
    process.env.PAYFAST_PASSPHRASE = "jt7NOE43FZPn";
    const itnFields: [string, string][] = [
      ["m_payment_id", "0198f0aa-1111-7000-8000-abcdefabcdef"],
      ["pf_payment_id", "1089250"],
      ["payment_status", "COMPLETE"],
      ["item_name", "Needd Connect order NC-2026-00002"],
      ["amount_gross", "764.00"],
    ];
    const sig = signPayload(itnFields, "jt7NOE43FZPn");
    const params = new URLSearchParams();
    for (const [k, v] of itnFields) params.set(k, v);
    params.set("signature", sig);
    expect(verifyItnSignature(params)).toBe(true);
    params.set("amount_gross", "999.00"); // tamper
    expect(verifyItnSignature(params)).toBe(false);
  });
});
