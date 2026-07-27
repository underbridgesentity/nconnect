import { PLAN_CATEGORIES } from "./catalogue/constants";

/**
 * Operator-facing labels for database enums and audit actors.
 *
 * Money tables and reports read from here so nobody has to work out that
 * `eft_manual` means a bank transfer someone captured by hand, or that
 * `lte_home` is the category the public site calls Home Internet.
 */

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  payfast_card: "Card (PayFast)",
  payfast_token: "Card on file",
  eft_manual: "EFT (captured manually)",
};

/** Human label for a payment method, falling back to the raw value. */
export function paymentMethodLabel(value: string): string {
  return PAYMENT_METHOD_LABELS[value] ?? value;
}

const PLAN_CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  PLAN_CATEGORIES.map((c) => [c.value, c.label])
);

/** Human label for a plan category, falling back to the raw value. */
export function planCategoryLabel(value: string | null | undefined): string {
  if (!value) return "Uncategorised";
  return PLAN_CATEGORY_LABELS[value] ?? value;
}

/**
 * "Thabo Nkosi (admin)", or "System" for cron, webhook and outbox writes.
 * An audit trail that cannot name the actor fails the purpose it exists for.
 */
export function actorLabel(
  name: string | null | undefined,
  role: string | null | undefined
): string {
  if (!name) return role && role !== "system" ? `Unnamed ${role}` : "System";
  return role ? `${name} (${role})` : name;
}

/** Reconciliation flags, spelled out for the operator resolving them. */
export const RECON_FLAG_LABELS: Record<string, string> = {
  ok: "Matches",
  missing_from_statement: "Not on the statement",
  amount_delta: "Amount differs",
  no_cost_price: "No cost price set",
};
