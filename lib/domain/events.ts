import "server-only";
import { isNull, eq, asc } from "drizzle-orm";
import { db, type Tx } from "@/lib/db/client";
import { domainEvents } from "@/lib/db/schema";
import { inngest } from "@/inngest/client";

/**
 * Outbox pattern (spec §4.7): domain functions write events in the same
 * transaction as their mutation via `emitDomainEvent(tx, ...)`, then a
 * best-effort forward happens after commit. The Inngest poller
 * (`outbox-drain`) picks up anything the best-effort pass missed, so no
 * event is ever lost.
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

/** Fire-and-forget forward after the transaction commits. */
export async function forwardDomainEvent(eventId: string): Promise<void> {
  try {
    const [event] = await db
      .select()
      .from(domainEvents)
      .where(eq(domainEvents.id, eventId))
      .limit(1);
    if (!event || event.forwardedAt) return;
    await inngest.send({
      name: `domain/${event.name}`,
      data: { ...event.payload, eventId: event.id },
    });
    await db
      .update(domainEvents)
      .set({ forwardedAt: new Date() })
      .where(eq(domainEvents.id, event.id));
  } catch (err) {
    // The outbox drainer will retry; never fail the caller.
    console.error(`forwardDomainEvent(${eventId}) failed:`, err);
  }
}

/** Used by the Inngest outbox-drain cron. Returns number forwarded. */
export async function drainUnforwardedEvents(limit = 100): Promise<number> {
  const pending = await db
    .select()
    .from(domainEvents)
    .where(isNull(domainEvents.forwardedAt))
    .orderBy(asc(domainEvents.createdAt))
    .limit(limit);

  let forwarded = 0;
  for (const event of pending) {
    try {
      await inngest.send({
        name: `domain/${event.name}`,
        data: { ...event.payload, eventId: event.id },
      });
      await db
        .update(domainEvents)
        .set({ forwardedAt: new Date() })
        .where(eq(domainEvents.id, event.id));
      forwarded++;
    } catch (err) {
      console.error(`outbox drain failed for ${event.id}:`, err);
      break; // preserve ordering; retry next run
    }
  }
  return forwarded;
}
