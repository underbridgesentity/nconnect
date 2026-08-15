import "server-only";
import { sha256, safeEqualHex } from "@/lib/crypto";

/**
 * The door on every `/api/cron/*` route.
 *
 * One implementation rather than one per route: these endpoints walk the
 * billing book and write leads, so the difference between two copies of an
 * authentication check drifting apart and a hole in the platform is a single
 * careless edit. Adding a job should be adding a schedule and a handler, never
 * re-deriving how to check the secret.
 */

/** Sent with no cache headers ever, because a cached answer here is a lie. */
const NO_STORE = { "Cache-Control": "no-store" } as const;

export type CronGate = { ok: true } | { ok: false; response: Response };

/**
 * Vercel sends `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is set on
 * the project. Compared through SHA-256 digests so the comparison is both
 * constant time and fixed length: timingSafeEqual on the raw values would
 * throw on a length mismatch, and guarding that with an early length check
 * leaks the secret's length.
 */
function authorised(req: Request, secret: string): boolean {
  const header = req.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const presented = bearer || req.headers.get("x-cron-secret")?.trim() || "";
  if (!presented) return false;

  return safeEqualHex(sha256(presented), sha256(secret));
}

/**
 * Decide whether this request may run the job, and if not, what to answer.
 *
 * `job` names the work in the 503 body, because "which job is not armed" is
 * the first thing anyone reading that response wants to know.
 */
export function gateCronRequest(req: Request, job: string): CronGate {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    // Refuse rather than run open. An unauthenticated endpoint that walks the
    // whole billing book is a far worse problem than a job that is not armed
    // yet, and answering plainly is what gets CRON_SECRET set.
    return {
      ok: false,
      response: Response.json(
        {
          code: "cron_not_configured",
          message: `CRON_SECRET is not set on this deployment, so ${job} refuses to run. Set it in the Vercel project and redeploy.`,
        },
        { status: 503, headers: NO_STORE }
      ),
    };
  }

  if (!authorised(req, secret)) {
    return {
      ok: false,
      response: Response.json(
        { code: "unauthorized" },
        { status: 401, headers: NO_STORE }
      ),
    };
  }

  return { ok: true };
}

/** Every successful cron answer, so the shape does not drift between routes. */
export function cronJson(
  body: Record<string, unknown>,
  status = 200
): Response {
  return Response.json(body, { status, headers: NO_STORE });
}
