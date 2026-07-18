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
export const inngest = new Inngest({ id: "needd-connect" });
