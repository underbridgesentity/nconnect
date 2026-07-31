import { describe, it, expect } from "vitest";
import { normalizeEmail, isValidEmail } from "@/lib/auth/otp";

/**
 * Email is the customer sign-in credential, so the address stored at signup and
 * the address looked up at sign-in must be the same string.
 *
 * findOrCreateCustomer used to key on phone and write no email onto the user
 * row at all, which meant nobody who signed up could ever sign in: the account
 * existed, the customer record carried the address, and the credential column
 * was null. These pin the normalisation both sides rely on.
 */
describe("email as the sign-in credential", () => {
  it("normalises case and surrounding space, so one address is one account", () => {
    for (const raw of [
      "Thandi@Example.com",
      "  thandi@example.com  ",
      "THANDI@EXAMPLE.COM",
    ]) {
      expect(normalizeEmail(raw)).toBe("thandi@example.com");
    }
  });

  it("is idempotent, so re-normalising a stored address cannot drift", () => {
    const once = normalizeEmail("Thandi@Example.com");
    expect(normalizeEmail(once)).toBe(once);
  });

  it("accepts the shapes real customers type", () => {
    for (const ok of [
      "thandi@example.com",
      "thandi.mbeki@example.co.za",
      "delivered+e2e123@resend.dev",
      "t@e.co",
    ]) {
      expect(isValidEmail(ok)).toBe(true);
    }
  });

  it("rejects what cannot receive a code", () => {
    for (const bad of ["", "   ", "thandi", "thandi@", "@example.com", "a b@c.com"]) {
      expect(isValidEmail(bad)).toBe(false);
      expect(() => normalizeEmail(bad)).toThrow();
    }
  });
});
