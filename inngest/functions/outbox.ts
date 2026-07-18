import { cron } from "inngest";
import { inngest } from "../client";
import { drainUnforwardedEvents } from "@/lib/domain/events";

/**
 * Safety net for the outbox pattern: forwards any domain_events rows the
 * post-commit best-effort send missed. Runs every 5 minutes.
 */
export const outboxDrain = inngest.createFunction(
  { id: "outbox-drain", triggers: [cron("*/5 * * * *")] },
  async () => {
    const forwarded = await drainUnforwardedEvents();
    return { forwarded };
  }
);
