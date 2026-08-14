import { cron } from "inngest";
import { inngest } from "../client";
import { drainUnforwardedEvents } from "@/lib/domain/events";
import { recordJobHeartbeat } from "@/lib/domain/ops-health";

/**
 * Safety net for the outbox pattern: forwards any domain_events rows the
 * post-commit best-effort send missed. Runs every 5 minutes.
 */
export const outboxDrain = inngest.createFunction(
  { id: "outbox-drain", triggers: [cron("*/5 * * * *")] },
  async () => {
    const forwarded = await drainUnforwardedEvents();
    // Recorded so the admin readout can tell "drained, nothing waiting" apart
    // from "has not run since the keys went missing". Both leave an empty
    // backlog, and only one of them is fine.
    await recordJobHeartbeat("outbox-drain", "inngest", { forwarded });
    return { forwarded };
  }
);
