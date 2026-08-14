import { Inngest } from "inngest";

/**
 * Domain events flow: written to `domain_events` in the mutation's
 * transaction (outbox), then forwarded to Inngest by the drainer so no event
 * is ever lost (spec §4.7). Functions subscribe to `domain/*` events.
 *
 * Event names used across the platform:
 *   domain/order.paid, domain/service.transitioned, domain/payment.received,
 *   domain/payment.failed, domain/invoice.issued, domain/quote.sent,
 *   domain/quote.viewed, domain/quote.accepted, domain/lead.created,
 *   domain/conversation.message, domain/notification.requested
 * Every payload carries { eventId } pointing at the domain_events row.
 */

/**
 * Which mode the SDK runs in, decided rather than inherited.
 *
 * inngest v4 does not look at NODE_ENV: with no options and no INNGEST_DEV it
 * assumes cloud mode everywhere, which is why `/api/inngest` answered an
 * opaque 500 on a laptop with no keys exactly as it did in production. That
 * made the production outage look like normal local behaviour and is a large
 * part of why nobody noticed the jobs were dead.
 *
 * INNGEST_DEV still wins when it is set, because it is the SDK's own switch
 * and someone who sets it means it. Returning undefined hands the decision
 * back to the SDK, which reads that variable itself.
 *
 * Production is unchanged: NODE_ENV is "production" on Vercel, so this
 * resolves to cloud mode exactly as before.
 */
function resolveIsDev(): boolean | undefined {
  if (process.env.INNGEST_DEV) return undefined;
  return process.env.NODE_ENV !== "production";
}

export const inngest = new Inngest({
  id: "needd-connect",
  isDev: resolveIsDev(),
});
