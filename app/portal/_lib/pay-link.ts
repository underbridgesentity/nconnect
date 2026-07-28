import { payLinkFor } from "@/lib/domain/billing-engine";

/**
 * A pay link opened from inside the portal.
 *
 * `from=portal` is what tells the pay page to send the customer back into the
 * portal when they are done. Without it they land on the public pay-link
 * outcome page, which is written for somebody who arrived from an SMS and has
 * nowhere to go next, so a signed-in customer is dropped out of the app they
 * were already in.
 *
 * Both portal screens that offer payment used to carry their own copy of this
 * one-liner, with a comment on each saying it had to stay identical to the
 * other. One of them was going to drift.
 */
export function portalPayLink(invoiceId: string): string {
  return `${payLinkFor(invoiceId)}&from=portal`;
}
