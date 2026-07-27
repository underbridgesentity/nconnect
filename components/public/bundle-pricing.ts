import { add, multiply, subtract, type Cents } from "@/lib/money";
import type { BundleWithItems } from "@/lib/domain/catalogue";

/**
 * What a bundle saves against buying the same items separately.
 *
 * "Grab this deal" was an unsupported claim: neither the index nor the detail
 * page ever totalled the parts. The numbers are already in the catalogue, so
 * we add them up here in integer cents (house rule: money never touches a
 * float) and return null when there is nothing honest to show, which is any
 * of: an item we cannot price, a bundle priced at or above its parts.
 */
export function bundleComponentTotalCents(
  bundle: BundleWithItems
): Cents | null {
  let total: Cents = 0;
  for (const item of bundle.items) {
    const unit =
      item.plan?.priceCents ??
      item.hardware?.priceCents ??
      item.customPriceCents;
    if (unit === null || unit === undefined) return null;
    total = add(total, multiply(unit, item.qty));
  }
  return total;
}

/** Positive saving in cents, or null when there is none to claim. */
export function bundleSavingCents(bundle: BundleWithItems): Cents | null {
  const total = bundleComponentTotalCents(bundle);
  if (total === null) return null;
  const saving = subtract(total, bundle.priceCents);
  return saving > 0 ? saving : null;
}
