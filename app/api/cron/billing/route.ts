import type { NextRequest } from "next/server";
import { todayInJohannesburg } from "@/lib/domain/services";
import { ranOnDate } from "@/lib/domain/ops-health";
import { gateCronRequest, cronJson } from "@/lib/jobs/cron-auth";
import { runNightlyBilling } from "@/lib/jobs/billing-run";

/**
 * The nightly billing run (spec 6.1), scheduled by Vercel Cron at 00:00 UTC,
 * which is 02:00 Africa/Johannesburg. Declared in vercel.json as "0 0 * * *".
 *
 * This is the primary runner, not a backstop. It began life as a second path
 * behind an Inngest cron, running 40 minutes later in case Inngest was
 * misconfigured; on 2026-08-15 Inngest was dropped, because all three of its
 * functions were plain crons and nothing subscribed to the domain events, so
 * it was a scheduler and nothing more. One scheduler, already required for the
 * deployment, is fewer accounts and fewer third-party outages between the
 * business and its invoicing. The schedule moved back to 00:00 UTC because
 * there is no longer a first run to sit behind.
 *
 * Why this job is worth its own protections at all: the month-one invoice is
 * written inline by the PayFast webhook, so a new customer looks perfectly
 * billed even when nothing is scheduled, and the failure only surfaces when
 * month two never arrives about thirty days later.
 *
 * Why running it twice is safe, verified by reading lib/domain/billing-engine
 * rather than assumed:
 *
 *  - runInvoiceGeneration opens a transaction per service, takes
 *    SELECT ... FOR UPDATE on the service row, and re-reads next_invoice_date
 *    under that lock, so an overlapping run sees the pointer already advanced
 *    and returns. It then checks for an existing invoice on
 *    (service_id, period_start) before inserting, and migration
 *    0006_invoice_period_unique backs that with a partial unique index in the
 *    database, so a duplicate month is refused by Postgres even if application
 *    code is bypassed entirely.
 *  - runDunning only charges when no non-skipped collection_attempts row
 *    exists for that (invoice_id, attempt_no) slot, so a second pass on the
 *    same day spends no new attempt.
 *  - runCancellationSweep only selects services still in pending_cancellation,
 *    and finalising moves them out of it, so the second pass sees nothing.
 *
 * Belt and braces on top of all that: if a billing run already recorded a
 * heartbeat for today's Africa/Johannesburg date, this route reports that and
 * does no work. Vercel can fire a cron more than once, and this is what makes
 * the repeat cost nothing instead of walking the whole book again. A run that
 * failed part way through never wrote a heartbeat, so a retry still picks it
 * up.
 */

// Cron requests must never be served from a cache, and this route must not be
// statically evaluated at build time.
export const dynamic = "force-dynamic";
// Comfortably above what the nightly run needs on this book, and within the
// ceiling on every Vercel plan including Hobby.
export const maxDuration = 60;

export async function GET(req: NextRequest): Promise<Response> {
  const gate = gateCronRequest(req, "the nightly billing run");
  if (!gate.ok) return gate.response;

  const today = todayInJohannesburg();

  try {
    if (await ranOnDate("billing-run", today)) {
      return cronJson({
        ok: true,
        ran: false,
        today,
        reason:
          "Billing already completed for this date, so this call stood down.",
      });
    }

    const result = await runNightlyBilling("vercel-cron", today);
    console.warn(`billing run completed for ${today}: ${JSON.stringify(result)}`);
    return cronJson({ ok: true, ran: true, ...result });
  } catch (err) {
    // Answer 500 so the failure shows in Vercel's cron history instead of a
    // green tick over a night that did not bill.
    console.error(`billing run failed for ${today}:`, err);
    return cronJson(
      {
        ok: false,
        today,
        error: err instanceof Error ? err.message : "Billing run failed",
      },
      500
    );
  }
}
