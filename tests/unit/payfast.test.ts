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

/**
 * ITN verification and redirect signing disagree about blank fields, and the
 * difference decides whether real payments complete.
 *
 * PayFast's merchant-side ITN reference iterates every posted variable and
 * includes empty ones as "key=". Live ITNs routinely carry blank optionals
 * (name_last, custom_str1 to 5, token). Filtering them out, which is correct
 * for the outgoing redirect, produces a different digest, so every genuine
 * payment would fail verification and no order would ever be marked paid.
 *
 * The expected digests below were computed with an independent PHP-urlencode
 * reference implementation, not with the code under test.
 */
describe("ITN signature verification with blank fields", () => {
  const passphrase = "_/A1b2-test";
  const itn: [string, string][] = [
    ["m_payment_id", "019fa58e-2ad3-7a28-876c-dc21351933bc"],
    ["pf_payment_id", "1089250"],
    ["payment_status", "COMPLETE"],
    ["item_name", "Needd Connect order NC-2026-00007"],
    ["name_first", "Thandi"],
    ["name_last", ""],
    ["email_address", "thandi@example.com"],
    ["amount_gross", "764.00"],
    ["amount_fee", "-20.85"],
    ["amount_net", "743.15"],
    ["custom_str1", ""],
    ["custom_str2", ""],
    ["token", ""],
  ];

  it("signs every posted field, including the blanks", () => {
    expect(signPayload(itn, passphrase, { skipEmpty: false })).toBe(
      "1a08430d3571e5c43955b74891d3cf2d"
    );
  });

  it("still skips blanks for the outgoing redirect signature", () => {
    expect(signPayload(itn, passphrase)).toBe(
      "8f35423b4b0fa2eb37010a6e67d3c978"
    );
  });

  it("verifies a real-shaped ITN that carries blank optional fields", () => {
    process.env.PAYFAST_MERCHANT_ID = "16240038";
    process.env.PAYFAST_MERCHANT_KEY = "test-key";
    process.env.PAYFAST_PASSPHRASE = passphrase;

    const params = new URLSearchParams();
    for (const [k, v] of itn) params.set(k, v);
    params.set("signature", signPayload(itn, passphrase, { skipEmpty: false }));
    expect(verifyItnSignature(params)).toBe(true);

    // A signature computed the old way must not be accepted.
    params.set("signature", signPayload(itn, passphrase));
    expect(verifyItnSignature(params)).toBe(false);
  });
});
