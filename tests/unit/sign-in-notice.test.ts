import { describe, it, expect } from "vitest";
import {
  signInReasonFromParams,
  staffSignInNotice,
} from "@/lib/auth/sign-in-notice";
import { callbackUrlFromParams } from "@/lib/auth/callback-url";
import { roleCanOpen } from "@/lib/auth/permissions";

/**
 * What the staff sign-in page says, and where it agrees to send someone.
 *
 * Two things are being protected. The first is honesty: a signed-in person
 * with the wrong role must be told the account is wrong, not left to retype a
 * password that was never the problem. The second is the redirect itself. The
 * destination arrives in the URL, is shown on the page and then rides a hidden
 * field back to the server, so an off-origin value must not survive any leg of
 * that trip.
 */

/** The page's own pipeline: raw params in, notice out. */
function noticeFromParams(
  params: Record<string, string | string[] | undefined>,
  session: { role: "admin" | "sales" | "customer" | null; identity?: string }
) {
  return staffSignInNotice({
    reason: signInReasonFromParams(params),
    role: session.role,
    identity: session.identity ?? null,
    destination: callbackUrlFromParams(params),
  });
}

describe("roleCanOpen", () => {
  /**
   * This has to agree with the role gate in proxy.ts, because the sign-in
   * screen uses it to explain what the gate just did. If they disagree, the
   * page tells someone they can open a page that will bounce them.
   */
  it("keeps /admin to admins", () => {
    expect(roleCanOpen("/admin", "admin")).toBe(true);
    expect(roleCanOpen("/admin/settings", "admin")).toBe(true);
    expect(roleCanOpen("/admin", "sales")).toBe(false);
    expect(roleCanOpen("/admin/settings", "customer")).toBe(false);
  });

  it("lets admin into the sales workspace, and nobody else outside it", () => {
    expect(roleCanOpen("/sales/leads", "sales")).toBe(true);
    expect(roleCanOpen("/sales/leads", "admin")).toBe(true);
    expect(roleCanOpen("/sales/leads", "customer")).toBe(false);
  });

  it("keeps the portal to customers", () => {
    expect(roleCanOpen("/portal/billing", "customer")).toBe(true);
    expect(roleCanOpen("/portal/billing", "admin")).toBe(false);
    expect(roleCanOpen("/portal", "sales")).toBe(false);
  });

  it("leaves everything outside the gated areas open", () => {
    for (const role of ["admin", "sales", "customer"] as const) {
      expect(roleCanOpen("/", role)).toBe(true);
      expect(roleCanOpen("/pricing", role)).toBe(true);
      expect(roleCanOpen("/q/abc123", role)).toBe(true);
    }
  });

  it("matches whole segments, not letter prefixes", () => {
    // The gate's route matcher never sees these, so neither should we.
    expect(roleCanOpen("/administrators", "sales")).toBe(true);
    expect(roleCanOpen("/salesforce", "customer")).toBe(true);
    expect(roleCanOpen("/portals", "admin")).toBe(true);
  });

  it("still gates a path carrying a query or fragment", () => {
    expect(roleCanOpen("/admin?tab=orders", "sales")).toBe(false);
    expect(roleCanOpen("/admin#top", "sales")).toBe(false);
    expect(roleCanOpen("/portal/billing?invoice=123", "sales")).toBe(false);
  });
});

describe("signInReasonFromParams", () => {
  it("reads the reasons the role gate can give", () => {
    expect(signInReasonFromParams({ reason: "role" })).toBe("role");
    expect(signInReasonFromParams({ reason: "session" })).toBe("session");
  });

  it("takes the first value when the parameter is repeated", () => {
    expect(signInReasonFromParams({ reason: ["role", "session"] })).toBe("role");
  });

  it("ignores anything not on the list", () => {
    expect(signInReasonFromParams({})).toBeNull();
    expect(signInReasonFromParams({ reason: "" })).toBeNull();
    expect(signInReasonFromParams({ reason: "banned" })).toBeNull();
    expect(signInReasonFromParams({ reason: "<script>" })).toBeNull();
    expect(signInReasonFromParams({ reason: [] })).toBeNull();
  });
});

describe("staffSignInNotice, signed in on the wrong account", () => {
  const params = { reason: "role", next: "/admin/settings" };

  it("blames the account, not the password", () => {
    const notice = noticeFromParams(params, {
      role: "sales",
      identity: "thabo@needdconnect.co.za",
    });
    expect(notice).not.toBeNull();
    expect(notice!.tone).toBe("blocked");
    expect(notice!.detail).toContain("thabo@needdconnect.co.za");
    expect(notice!.detail).toContain("a sales account");
    expect(notice!.detail).toContain("cannot open that page");
    expect(notice!.detail).not.toContain("password");
  });

  it("keeps the page they were opening, so it can be shown back to them", () => {
    const notice = noticeFromParams(params, { role: "customer" });
    expect(notice!.destination).toBe("/admin/settings");
  });

  it("offers the role router, never a second opinion on where a role lives", () => {
    for (const role of ["sales", "customer"] as const) {
      const notice = noticeFromParams(params, { role });
      expect(notice!.onward?.href).toBe("/after-login");
      expect(notice!.onward?.label.length).toBeGreaterThan(0);
    }
  });

  it("still explains itself when the session carries no name or email", () => {
    const notice = noticeFromParams(params, { role: "customer" });
    expect(notice!.detail).toContain("a customer account");
    expect(notice!.detail).not.toContain("undefined");
    expect(notice!.detail).not.toContain("null");
  });

  it("works out the refusal from the destination alone", () => {
    // No reason parameter at all: the area map and the path are enough, so a
    // wrong-role visitor is told the truth even before the gate says why.
    const notice = noticeFromParams(
      { next: "/admin" },
      { role: "sales", identity: "thabo@needdconnect.co.za" }
    );
    expect(notice!.tone).toBe("blocked");
  });

  it("names the gated area a sales account may share with admin", () => {
    expect(noticeFromParams({ next: "/sales/leads" }, { role: "sales" })!.tone).toBe(
      "info"
    );
    expect(noticeFromParams({ next: "/sales/leads" }, { role: "admin" })!.tone).toBe(
      "info"
    );
    expect(
      noticeFromParams({ next: "/sales/leads" }, { role: "customer" })!.tone
    ).toBe("blocked");
  });
});

describe("staffSignInNotice never accuses the wrong person", () => {
  it("does not tell an admin they cannot open an admin page", () => {
    // A stale bookmark of this form carrying a destination the account can
    // actually open. Claiming otherwise would send them hunting for a second
    // account that does not exist.
    const notice = noticeFromParams(
      { reason: "role", next: "/admin/orders" },
      { role: "admin", identity: "ops@needdconnect.co.za" }
    );
    expect(notice!.tone).toBe("info");
    expect(notice!.detail).toContain("it can open that page");
    expect(notice!.onward?.href).toBe("/admin/orders");
  });

  it("treats a page outside the gated areas as open to anyone", () => {
    const notice = noticeFromParams({ next: "/pricing" }, { role: "customer" });
    expect(notice!.tone).toBe("info");
    expect(notice!.onward?.href).toBe("/pricing");
  });

  it("does not read /administrators as the admin area", () => {
    // The role gate's route matcher stops at a segment boundary, so a path
    // that merely starts with the same letters is not gated.
    const notice = noticeFromParams(
      { next: "/administrators" },
      { role: "sales" }
    );
    expect(notice!.tone).toBe("info");
  });
});

describe("staffSignInNotice, other arrivals", () => {
  it("tells a signed-out visitor with a destination they will land on it", () => {
    const notice = noticeFromParams(
      { next: "/admin/services" },
      { role: null }
    );
    expect(notice!.tone).toBe("info");
    expect(notice!.destination).toBe("/admin/services");
    expect(notice!.detail).toContain("straight there");
    expect(notice!.onward).toBeNull();
  });

  it("says a staff account is needed when the role gate said so", () => {
    const notice = noticeFromParams({ reason: "role" }, { role: null });
    expect(notice!.title).toContain("staff account");
    expect(notice!.destination).toBeNull();
  });

  it("does not accuse someone who simply opened the page of anything", () => {
    expect(noticeFromParams({}, { role: null })).toBeNull();
  });

  it("greets an already signed-in visitor without blocking language", () => {
    const notice = noticeFromParams(
      {},
      { role: "admin", identity: "ops@needdconnect.co.za" }
    );
    expect(notice!.tone).toBe("info");
    expect(notice!.title).toBe("You are already signed in");
    expect(notice!.onward?.href).toBe("/after-login");
  });

  it("explains an ended session", () => {
    const notice = noticeFromParams({ reason: "session" }, { role: null });
    expect(notice!.title).toContain("session has ended");
  });
});

describe("the destination the staff page will act on", () => {
  const HOSTILE = [
    "//evil.example/admin",
    "https://evil.example/admin",
    "/\\evil.example",
    "javascript:alert(1)",
    "/admin\nSet-Cookie: role=admin",
  ];

  it("drops an off-origin destination before it reaches the screen", () => {
    for (const next of HOSTILE) {
      const notice = noticeFromParams({ reason: "role", next }, { role: "sales" });
      // The person is still told why they are here, but nothing hostile is
      // echoed back at them or carried into the form.
      expect(notice!.destination).toBeNull();
      expect(callbackUrlFromParams({ next })).toBeNull();
    }
  });

  it("refuses a destination that would bounce them straight back here", () => {
    expect(callbackUrlFromParams({ next: "/staff-login" })).toBeNull();
    expect(callbackUrlFromParams({ next: "/staff-login?next=/admin" })).toBeNull();
    expect(callbackUrlFromParams({ next: "/login" })).toBeNull();
  });

  it("keeps a real staff deep link whole, query and all", () => {
    expect(
      callbackUrlFromParams({ next: "/admin/orders?status=pending#top" })
    ).toBe("/admin/orders?status=pending#top");
  });

  it("shows a destination only after it has been validated", () => {
    // Whatever is echoed on screen is the resolved relative path, so a
    // disguised absolute URL can never appear as a trustworthy-looking link.
    const notice = noticeFromParams(
      { reason: "role", next: "/admin/../sales/leads" },
      { role: "customer" }
    );
    expect(notice!.destination).toBe("/sales/leads");
  });
});
