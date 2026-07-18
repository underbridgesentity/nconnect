/**
 * Typed capability map (spec §12). `authorize()` consumes this; role checks
 * never live inline in route handlers or components.
 *
 * Scope meanings:
 *  - "all":   no resource restriction
 *  - "own":   sales — resource must belong to / be assigned to the actor
 *  - "self":  customer — resource must be the actor's own record
 *  - "none":  capability denied outright
 * Some capabilities carry a narrower qualifier documented inline.
 */

export const ROLES = ["admin", "sales", "customer"] as const;
export type Role = (typeof ROLES)[number];

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
