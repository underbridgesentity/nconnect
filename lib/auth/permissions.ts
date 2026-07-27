/**
 * Typed capability map (spec §12). `authorize()` consumes this; role checks
 * never live inline in route handlers or components.
 *
 * Scope meanings:
 *  - "all":   no resource restriction
 *  - "own":   sales, resource must belong to / be assigned to the actor
 *  - "self":  customer, resource must be the actor's own record
 *  - "none":  capability denied outright
 * Some capabilities carry a narrower qualifier documented inline.
 */

export const ROLES = ["admin", "sales", "customer"] as const;
export type Role = (typeof ROLES)[number];

/**
 * The three gated surfaces and who may open them. proxy.ts enforces this on
 * every request; anything that needs to *explain* the gate (the sign-in screens
 * above all) reads it from here rather than keeping a second list, because a
 * second list drifts and then the explanation contradicts the enforcement.
 */
export const ROLE_AREAS = [
  { prefix: "/admin", roles: ["admin"] },
  { prefix: "/sales", roles: ["sales", "admin"] },
  { prefix: "/portal", roles: ["customer"] },
] as const satisfies readonly { prefix: string; roles: readonly Role[] }[];

/**
 * May this role open this same-origin relative path? Paths outside the gated
 * areas are open to everyone, signed in or not.
 *
 * Matching stops at a segment boundary, which is what the gate actually does:
 * its route matcher is "/admin/:path*", so "/administrators" never reaches it.
 * A plain prefix test here would call that path admin-only and have the screen
 * tell someone they cannot open a page they can.
 */
export function roleCanOpen(path: string, role: Role): boolean {
  const area = ROLE_AREAS.find(
    (a) =>
      path === a.prefix ||
      a.prefix.length < path.length &&
        path.startsWith(a.prefix) &&
        "/?#".includes(path[a.prefix.length]!)
  );
  if (!area) return true;
  return (area.roles as readonly Role[]).includes(role);
}

export type Scope = "all" | "own" | "self" | "none";

export const CAPABILITIES = [
  "catalogue.read",
  "catalogue.write",
  "catalogue.publish",
  "customer.read",
  "customer.write",
  "order.create",
  "service.transition",
  "invoice.read",
  "invoice.void",
  "invoice.adjust",
  "payment.record_manual",
  "billing.settings",
  "billing.reconciliation",
  "inbox.read",
  "inbox.reply",
  "lead.read",
  "lead.write",
  "quote.create",
  "quote.send",
  "quote.discount_below_floor",
  "reports.read",
  "settings.write",
  "staff.manage",
  "audit.read",
  "rica.verify",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const PERMISSION_MAP: Record<Capability, Record<Role, Scope>> = {
  // customer scope "self" on catalogue.read means: published records only
  "catalogue.read": { admin: "all", sales: "all", customer: "self" },
  "catalogue.write": { admin: "all", sales: "none", customer: "none" },
  "catalogue.publish": { admin: "all", sales: "none", customer: "none" },
  "customer.read": { admin: "all", sales: "own", customer: "self" },
  // sales customer.write is limited to contact fields + notes (enforced in domain fn)
  "customer.write": { admin: "all", sales: "own", customer: "self" },
  // sales order.create only via accepted quote; customer only via signup
  "order.create": { admin: "all", sales: "own", customer: "self" },
  // customer service.transition limited to cancel-request + plan-change on own
  "service.transition": { admin: "all", sales: "none", customer: "self" },
  // sales invoice.read on own customers is status-only (enforced in domain fn)
  "invoice.read": { admin: "all", sales: "own", customer: "self" },
  "invoice.void": { admin: "all", sales: "none", customer: "none" },
  "invoice.adjust": { admin: "all", sales: "none", customer: "none" },
  "payment.record_manual": { admin: "all", sales: "none", customer: "none" },
  "billing.settings": { admin: "all", sales: "none", customer: "none" },
  "billing.reconciliation": { admin: "all", sales: "none", customer: "none" },
  "inbox.read": { admin: "all", sales: "own", customer: "self" },
  "inbox.reply": { admin: "all", sales: "own", customer: "self" },
  "lead.read": { admin: "all", sales: "own", customer: "none" },
  "lead.write": { admin: "all", sales: "own", customer: "none" },
  "quote.create": { admin: "all", sales: "own", customer: "none" },
  "quote.send": { admin: "all", sales: "own", customer: "none" },
  "quote.discount_below_floor": { admin: "all", sales: "none", customer: "none" },
  // sales reports.read: own pipeline only
  "reports.read": { admin: "all", sales: "own", customer: "none" },
  "settings.write": { admin: "all", sales: "none", customer: "none" },
  "staff.manage": { admin: "all", sales: "none", customer: "none" },
  "audit.read": { admin: "all", sales: "none", customer: "none" },
  "rica.verify": { admin: "all", sales: "none", customer: "none" },
};
