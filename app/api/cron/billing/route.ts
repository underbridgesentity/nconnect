import type { NextRequest } from "next/server";
import { sha256, safeEqualHex } from "@/lib/crypto";
import { todayInJohannesburg } from "@/lib/domain/services";
import { ranOnDate } from "@/lib/domain/ops-health";
import { runNightlyBilling } from "@/inngest/functions/billing";

/**
 * Vercel Cron backstop for the nightly billing run.
 *
 * Why this exists at all. The whole reason this work started is that the
 * scheduled jobs were dead in production for a month and nothing said so: the
 * month-one invoice is written inline by the PayFast webhook, so a new
 * customer looks perfectly billed, and the failure only surfaces when month
 * two never arrives. Inngest is the right tool for the outbox drain and the
 * event-driven work, but the one job whose absence costs money directly should
 * not have a single point of failure in a third party we can misconfigure with
 * an unset env var. Vercel Cron calls a plain HTTP route on a schedule with no
 * account to link, no keys to sync, and no registration step that can silently
 * fail.
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
 *    same day spends no new attempt. That check is a read followed by a write
 *    without a lock, which is safe against a repeat but not against a
 *    genuinely simultaneous one, which is the second reason this route is
 *    scheduled 40 minutes after the Inngest run rather than alongside it.
 *  - runCancellationSweep only selects services still in pending_cancellation,
 *    and finalising moves them out of it, so the second pass sees nothing.
 *
 * Belt and braces on top of all that: if a billing run already recorded a
 * heartbeat for today's Africa/Johannesburg date, this route reports that and
 * does no work. On a normal night that is exactly what happens, so the
 * backstop is a no-op until the night Inngest lets us down. A run that failed
 * part way through never wrote a heartbeat, so the backstop still picks it up.
 */

// Cron requests must never be served from a cache, and this route must not be
// statically evaluated at build time.
export const dynamic = "force-dynamic";
// Comfortably above what the nightly run needs on this book, and within the
// ceiling on every Vercel plan including Hobby.
export const maxDuration = 60;

/**
 * Vercel sends `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is set on
 * the project. Compared through SHA-256 digests so the comparison is both
 * constant time and fixed length: timingSafeEqual on the raw values would
 * throw on a length mismatch, and guarding that with an early length check
 * leaks the secret's length.
 */
function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;

  const header = req.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const presented = bearer || req.headers.get("x-cron-secret")?.trim() || "";
  if (!presented) return false;

  return safeEqualHex(sha256(presented), sha256(secret));
}

export async function GET(req: NextRequest): Promise<Response> {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    // Refuse rather than run open. An unauthenticated endpoint that walks the
    // whole billing book is a far worse problem than a backstop that is not
    // armed yet, and answering plainly is what gets CRON_SECRET set.
    return Response.json(
      {
        code: "cron_not_configured",
        message:
          "CRON_SECRET is not set on this deployment, so the billing backstop refuses to run. Set it in the Vercel project and redeploy.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  if (!authorised(req)) {
    return Response.json(
      { code: "unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  const today = todayInJohannesburg();

  try {
    if (await ranOnDate("billing-run", today)) {
      return Response.json(
        {
          ok: true,
          ran: false,
          today,
          reason:
            "Billing already completed for this date, so the backstop stood down.",
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const result = await runNightlyBilling("vercel-cron", today);
    console.warn(
      `billing backstop ran for ${today} because no run was recorded: ${JSON.stringify(result)}`
    );
    return Response.json(
      { ok: true, ran: true, ...result },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    // Answer 500 so the failure shows in Vercel's cron history instead of a
    // green tick over a night that did not bill.
    console.error(`billing backstop failed for ${today}:`, err);
    return Response.json(
      {
        ok: false,
        today,
        error: err instanceof Error ? err.message : "Billing run failed",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
