import { describe, it, expect } from "vitest";
import {
  safeCallbackUrl,
  callbackUrlFromParams,
} from "@/lib/auth/callback-url";
import {
  normalizePhone,
  isValidPhone,
  formatPhoneForDisplay,
  PhoneFormatError,
} from "@/lib/auth/otp";
import { appUrl } from "@/lib/config";

/**
 * Two pure helpers that sit in front of the sign-in flow.
 *
 * `safeCallbackUrl` decides where a freshly signed-in person lands, from a
 * value that has been through the browser, so it is an open-redirect surface:
 * "//evil.example" and "https://evil.example" are what an attacker actually
 * sends, not a hypothetical. `normalizePhone` decides which row in `otp_codes`
 * a code is checked against, so 0821234567 and +27821234567 have to be the
 * same number or someone is locked out of their own account.
 */

/** The site's own origin, whatever APP_URL is set to in this environment. */
const ORIGIN = new URL(appUrl()).origin;

describe("safeCallbackUrl", () => {
  it("accepts a relative path, with its query and fragment", () => {
    expect(safeCallbackUrl("/portal")).toBe("/portal");
    expect(safeCallbackUrl("/portal/invoices/abc-123")).toBe(
      "/portal/invoices/abc-123"
    );
    expect(safeCallbackUrl("/portal/billing?tab=history#top")).toBe(
      "/portal/billing?tab=history#top"
    );
  });

  it("trims surrounding whitespace", () => {
    expect(safeCallbackUrl("  /portal/services  ")).toBe("/portal/services");
  });

  it("rejects a protocol-relative URL", () => {
    // "//evil.example" is another origin wearing a path's clothes.
    expect(safeCallbackUrl("//evil.example")).toBeNull();
    expect(safeCallbackUrl("//evil.example/portal")).toBeNull();
    // Backslash variant, which some browsers normalise to "//".
    expect(safeCallbackUrl("/\\evil.example")).toBeNull();
  });

  it("rejects an absolute URL on another origin", () => {
    expect(safeCallbackUrl("https://evil.example/portal")).toBeNull();
    expect(safeCallbackUrl("http://evil.example")).toBeNull();
    expect(safeCallbackUrl("javascript:alert(1)")).toBeNull();
    expect(safeCallbackUrl("data:text/html,<script>")).toBeNull();
  });

  it("reduces an absolute URL on our own origin to its path", () => {
    expect(safeCallbackUrl(`${ORIGIN}/portal/invoices?open=1`)).toBe(
      "/portal/invoices?open=1"
    );
  });

  it("rejects anything that is not a usable string", () => {
    expect(safeCallbackUrl(undefined)).toBeNull();
    expect(safeCallbackUrl(null)).toBeNull();
    expect(safeCallbackUrl(42)).toBeNull();
    expect(safeCallbackUrl({ toString: () => "/portal" })).toBeNull();
    expect(safeCallbackUrl("")).toBeNull();
    expect(safeCallbackUrl("   ")).toBeNull();
    expect(safeCallbackUrl(`/${"a".repeat(1024)}`)).toBeNull();
  });

  it("rejects control characters, which would let a header be spliced", () => {
    expect(safeCallbackUrl("/portal\nSet-Cookie: a=b")).toBeNull();
    expect(safeCallbackUrl("/portal\r\n/evil")).toBeNull();
    expect(safeCallbackUrl("/portal\u0000")).toBeNull();
  });

  it("resolves dot segments before judging the path", () => {
    expect(safeCallbackUrl("/portal/./billing")).toBe("/portal/billing");
    expect(safeCallbackUrl("/portal/../admin/services")).toBe(
      "/admin/services"
    );
    // Resolution happens first, so a disguised /login is still blocked.
    expect(safeCallbackUrl("/portal/../login")).toBeNull();
  });

  it("refuses routes that would bounce someone straight back", () => {
    expect(safeCallbackUrl("/login")).toBeNull();
    expect(safeCallbackUrl("/login?next=/portal")).toBeNull();
    expect(safeCallbackUrl("/staff-login")).toBeNull();
    expect(safeCallbackUrl("/setup/password")).toBeNull();
    expect(safeCallbackUrl("/api/files/catalogue/x.jpg")).toBeNull();
  });
});

describe("callbackUrlFromParams", () => {
  it("prefers the destination the proxy recorded", () => {
    expect(
      callbackUrlFromParams({ next: "/portal/invoices", callbackUrl: "/portal" })
    ).toBe("/portal/invoices");
  });

  it("falls back to Auth.js's own parameter", () => {
    expect(callbackUrlFromParams({ callbackUrl: "/portal/billing" })).toBe(
      "/portal/billing"
    );
  });

  it("falls back when the recorded destination is unsafe", () => {
    expect(
      callbackUrlFromParams({
        next: "https://evil.example/portal",
        callbackUrl: "/portal",
      })
    ).toBe("/portal");
  });

  it("takes the first value when a parameter is repeated", () => {
    expect(callbackUrlFromParams({ next: ["/portal/services", "/x"] })).toBe(
      "/portal/services"
    );
  });

  it("answers null when there is nothing usable", () => {
    expect(callbackUrlFromParams({})).toBeNull();
    expect(callbackUrlFromParams({ next: "//evil.example" })).toBeNull();
  });
});

describe("normalizePhone", () => {
  const EXPECTED = "+27821234567";

  it("accepts the three ways a South African number gets typed", () => {
    expect(normalizePhone("0821234567")).toBe(EXPECTED);
    expect(normalizePhone("+27821234567")).toBe(EXPECTED);
    expect(normalizePhone("27821234567")).toBe(EXPECTED);
  });

  it("ignores the spacing people put in a phone number", () => {
    expect(normalizePhone("082 123 4567")).toBe(EXPECTED);
    expect(normalizePhone("082-123-4567")).toBe(EXPECTED);
    expect(normalizePhone("(082) 123 4567")).toBe(EXPECTED);
    expect(normalizePhone("+27 82 123 4567")).toBe(EXPECTED);
  });

  it("throws a typed error on a number we cannot dial", () => {
    for (const bad of [
      "",
      "082123456", // one digit short
      "08212345678", // one digit long
      "1821234567", // does not start 0
      "+44821234567", // not South Africa
      "082 123 456a",
      "not a phone",
    ]) {
      expect(() => normalizePhone(bad)).toThrow(PhoneFormatError);
    }
  });

  it("is idempotent, so re-normalising a stored number is safe", () => {
    expect(normalizePhone(normalizePhone("0821234567"))).toBe(EXPECTED);
  });
});

describe("isValidPhone", () => {
  it("answers without throwing, for zod refinements and search boxes", () => {
    expect(isValidPhone("0821234567")).toBe(true);
    expect(isValidPhone("+27821234567")).toBe(true);
    expect(isValidPhone("27821234567")).toBe(true);
    expect(isValidPhone("082123456")).toBe(false);
    expect(isValidPhone("")).toBe(false);
  });
});

describe("formatPhoneForDisplay", () => {
  it("reads a stored number back the way its owner wrote it", () => {
    expect(formatPhoneForDisplay(normalizePhone("0821234567"))).toBe(
      "082 123 4567"
    );
  });

  it("leaves anything it does not recognise alone", () => {
    expect(formatPhoneForDisplay("+441632960961")).toBe("+441632960961");
  });
});
