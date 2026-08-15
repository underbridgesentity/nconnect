import type { NextRequest } from "next/server";
import { ranWithinMinutes } from "@/lib/domain/ops-health";
import { gateCronRequest, cronJson } from "@/lib/jobs/cron-auth";
import { runAbandonedSignupCapture } from "@/lib/jobs/abandoned-signups";

/**
 * Abandoned signup capture (spec 9.2), scheduled by Vercel Cron on the hour.
 * Declared in vercel.json as "0 * * * *".
 *
 * A signup that reached the contact step and then stopped is a person who
 * wanted the product and hit something. Six hours after they go quiet this
 * turns the draft into a `web_abandoned` lead so sales can call them, which
 * only works if it actually runs every hour, which is why it writes a
 * heartbeat: a quiet hour and a dead scheduler both capture zero leads and
 * only the heartbeat tells them apart.
 *
 * Why running it twice is safe: capture stamps `abandonedLeadCaptured` on the
 * draft in the same pass, so a second run over the same window creates no
 * second lead for anyone. The guard below is about not wasting the scan, not
 * about correctness.
 *
 * The stand-down window is 50 minutes rather than a calendar date, because a
 * date is far too coarse for an hourly job: a duplicate fire in the same slot
 * stands down, while the genuine next hour still runs even if the previous run
 * finished a few minutes late.
 */

export const dynamic = "force-dynamic";
// The scan is capped at 200 drafts and each capture is a couple of small
// writes, so this is generous rather than needed.
export const maxDuration = 60;

/** Comfortably under the hourly interval, comfortably over a duplicate fire. */
const STAND_DOWN_MINUTES = 50;

export async function GET(req: NextRequest): Promise<Response> {
  const gate = gateCronRequest(req, "abandoned signup capture");
  if (!gate.ok) return gate.response;

  try {
    if (await ranWithinMinutes("abandoned-signups", STAND_DOWN_MINUTES)) {
      return cronJson({
        ok: true,
        ran: false,
        reason: `Abandoned signup capture already ran within the last ${STAND_DOWN_MINUTES} minutes, so this call stood down.`,
      });
    }

    const result = await runAbandonedSignupCapture("vercel-cron");
    return cronJson({ ok: true, ran: true, ...result });
  } catch (err) {
    // 500 so a failing hour is red in Vercel's cron history rather than a
    // green tick over leads nobody will ever call.
    console.error("abandoned signup capture failed:", err);
    return cronJson(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "Abandoned signup capture failed",
      },
      500
    );
  }
}
