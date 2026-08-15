import "server-only";
import type { Tx } from "@/lib/db/client";
import { domainEvents } from "@/lib/db/schema";

/**
 * Outbox pattern (spec 4.7): domain functions write events in the same
 * transaction as their mutation via `emitDomainEvent(tx, ...)`.
 *
 * The write is the part that matters and it is unchanged. `domain_events` is
 * the platform's append-only record of what happened and why, and it is what
 * anyone would replay from if event-driven work is ever built. Every mutation
 * still writes to it, in the same transaction, so an event cannot exist
 * without its mutation or the other way round.
 */

export async function emitDomainEvent(
  tx: Tx,
  name: string,
  payload: Record<string, unknown>
): Promise<string> {
  const [row] = await tx
    .insert(domainEvents)
    .values({ name, payload })
    .returning({ id: domainEvents.id });
  return row.id;
}

/**
 * Deliberately does nothing, and says so rather than pretending.
 *
 * This used to push each committed event to Inngest. Inngest was dropped on
 * 2026-08-15 because nothing subscribed to `domain/*`: all three of its
 * functions were plain crons, which Vercel Cron now runs directly. With no
 * subscriber there is nowhere for a forward to go, so the honest version of
 * this function is an empty one. The alternative, leaving a send that always
 * fails, would produce a permanent trickle of errors that mean nothing and
 * would train everyone to ignore the log.
 *
 * The call sites are kept on purpose. They mark the exact points where an
 * event has committed and is safe to act on, which is precisely where a
 * consumer would hook in, and finding those points again later is harder than
 * leaving them in place.
 *
 * `domain_events.forwarded_at` stays in the schema and is now always null.
 * Dropping the column would be a migration against a live database for no
 * benefit. Nothing reads it, so it is dead weight rather than a wrong answer.
 *
 * When event-driven work is wanted, the shape of it is: replace this body with
 * the dispatch (a queue, a webhook, an in-process handler table), stamp
 * `forwarded_at` on success, and add a `/api/cron/*` route that sweeps rows
 * with a null `forwarded_at` so a dispatch that failed after commit is
 * retried. That sweeper is the piece deliberately not built today, because a
 * drainer with no destination is a job that can only ever succeed at nothing.
 */
export async function forwardDomainEvent(_eventId: string): Promise<void> {
  // Intentionally empty. See the comment above.
}
