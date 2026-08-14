import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  collectionAttempts,
  domainEvents,
  invoices,
  leads,
  services,
  settings,
} from "@/lib/db/schema";
import { getSetting } from "./settings";
import { todayInJohannesburg } from "./services";

/**
 * Is the scheduled work actually running?
 *
 * The failure this file exists to prevent: a customer signs up and pays month
 * one, because that invoice is written inline by the PayFast webhook, and then
 * month two is never invoiced because the nightly billing run never fired. No
 * exception, no failed request, no alert. The only symptom is revenue that
 * quietly does not arrive, noticed about thirty days later.
 *
 * Two independent signals are kept here, and the admin screen shows both,
 * because either one alone can lie:
 *
 *  1. Configuration. Whether the deployment even has the keys the Inngest SDK
 *     needs. Cheap, exact, and available with no database round trip.
 *
 *  2. Evidence that a run happened. A heartbeat written by each job when it
 *     finishes, plus backlog counts read from tables the jobs are supposed to
 *     drain. Backlog alone is not enough: with one customer and nothing due,
 *     "billing ran and found nothing" and "billing has never run" produce the
 *     identical empty backlog, which is exactly the silence we are trying to
 *     break. Hence the heartbeat. The heartbeat alone is not enough either,
 *     since it only proves the job started before it hit trouble, so the
 *     backlog counts stay as the corroborating fact.
 */

// ------------------------------------------------------------------ config

export type InngestMode = "cloud" | "dev";

export interface InngestConfig {
  mode: InngestMode;
  hasEventKey: boolean;
  hasSigningKey: boolean;
  /** True when this deployment can actually serve and run Inngest functions. */
  ready: boolean;
  /** Which env vars are missing, in the order they should be set. */
  missing: string[];
}

/**
 * Mirrors the SDK's own rule (`Inngest#mode` in inngest v4): an explicit
 * INNGEST_DEV wins, otherwise cloud. Kept in step with `inngest/client.ts`,
 * which passes `isDev` derived from NODE_ENV so the mode is a decision rather
 * than an accident.
 *
 * Deliberately reads process.env on every call rather than caching. Vercel
 * env changes arrive with a new deployment, but a cached "not configured"
 * that outlives the fix would be its own quiet lie.
 */
export function inngestConfig(): InngestConfig {
  const explicitDev = process.env.INNGEST_DEV?.trim();
  const mode: InngestMode =
    explicitDev && explicitDev !== "0" && explicitDev !== "false"
      ? "dev"
      : process.env.NODE_ENV === "production"
        ? "cloud"
        : "dev";

  const hasEventKey = Boolean(process.env.INNGEST_EVENT_KEY?.trim());
  const hasSigningKey = Boolean(process.env.INNGEST_SIGNING_KEY?.trim());

  const missing: string[] = [];
  if (!hasSigningKey) missing.push("INNGEST_SIGNING_KEY");
  if (!hasEventKey) missing.push("INNGEST_EVENT_KEY");

  // In dev mode the local Inngest dev server needs neither key, so the
  // endpoint is genuinely fine without them. In cloud mode both are load
  // bearing: the signing key authenticates Inngest's calls into us (without it
  // the SDK refuses every request), and the event key authenticates our sends
  // out (without it `inngest.send` throws, so the outbox never drains).
  return {
    mode,
    hasEventKey,
    hasSigningKey,
    ready: mode === "dev" || (hasEventKey && hasSigningKey),
    missing: mode === "dev" ? [] : missing,
  };
}

/** The nightly billing run has a second path that needs no Inngest at all. */
export function cronFallbackConfigured(): boolean {
  return Boolean(process.env.CRON_SECRET?.trim());
}

// --------------------------------------------------------------- heartbeat

export type JobKey = "billing-run" | "outbox-drain" | "abandoned-signups";
export type JobSource = "inngest" | "vercel-cron";

export interface JobHeartbeat {
  /** ISO 8601, UTC. Displayed in Africa/Johannesburg by lib/format. */
  at: string;
  source: JobSource;
  /** Whatever the run wants on the record, for example invoicesIssued: 0. */
  summary: Record<string, number | string | null>;
}

export type HeartbeatMap = Partial<Record<JobKey, JobHeartbeat>>;

/**
 * One settings row, `ops.scheduled_jobs`, holding the last completion of each
 * job.
 *
 * Why a settings row and not a new table: the whole record is three small
 * objects that are overwritten in place and never queried across, so a table
 * would buy nothing but a migration and an extra thing to back up. The
 * `settings` table already exists with exactly this shape (text key, jsonb
 * value) and already has a Drizzle model, so this adds no schema change to a
 * live database.
 *
 * Why it does not go through `updateSetting`: that is the audited path for
 * decisions a human made, and it writes an audit_log row per call. The outbox
 * drain finishes 288 times a day. Auditing that would bury the audit log,
 * which exists for POPIA and for answering "who changed this", under machine
 * noise. A heartbeat is operational telemetry, not a domain mutation: it
 * carries no business state, nothing reads it to make a decision, and losing
 * it costs nothing but the readout. So it is written directly, and the fact
 * that this bypasses the audited path is the reason for this paragraph.
 */
export const OPS_HEARTBEAT_KEY = "ops.scheduled_jobs";

export async function recordJobHeartbeat(
  job: JobKey,
  source: JobSource,
  summary: Record<string, number | string | null> = {}
): Promise<void> {
  const entry: JobHeartbeat = {
    at: new Date().toISOString(),
    source,
    summary,
  };
  const patch = JSON.stringify({ [job]: entry });

  try {
    // Merged server side with jsonb `||` rather than read-modify-write, so the
    // 5-minute drain and the nightly billing run cannot overwrite each other's
    // entry when their finishes overlap.
    await db
      .insert(settings)
      .values({ key: OPS_HEARTBEAT_KEY, value: JSON.parse(patch) })
      .onConflictDoUpdate({
        target: settings.key,
        set: {
          value: sql`coalesce(${settings.value}, '{}'::jsonb) || ${patch}::jsonb`,
        },
      });
  } catch (err) {
    // A heartbeat that cannot be written must never fail the run that just
    // did the real work. Losing the record is a reporting problem; failing
    // here after invoices were issued would be a billing problem.
    console.error(`recordJobHeartbeat(${job}) failed:`, err);
  }
}

export async function readHeartbeats(): Promise<HeartbeatMap> {
  return (await getSetting<HeartbeatMap>(OPS_HEARTBEAT_KEY)) ?? {};
}

/**
 * Has this job already completed on the given Africa/Johannesburg date?
 *
 * Used by the cron safety net so that on a normal night, when Inngest did the
 * work at 02:00, the 02:40 backstop reports "already ran" and does nothing
 * instead of walking the whole book a second time.
 */
export async function ranOnDate(job: JobKey, date: string): Promise<boolean> {
  const beats = await readHeartbeats();
  const at = beats[job]?.at;
  if (!at) return false;
  const parsed = new Date(at);
  if (Number.isNaN(parsed.getTime())) return false;
  return (
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Johannesburg",
    }).format(parsed) === date
  );
}

// ---------------------------------------------------------------- evidence

export interface JobEvidence {
  /** Plain sentence naming the table and column the number came from. */
  label: string;
  /** Shown as-is. Used when `at` is null. */
  value: string;
  /**
   * ISO instant when this piece of evidence is a timestamp. Left for the
   * caller to render, so it goes through lib/format and reaches the screen in
   * Africa/Johannesburg like every other time on the platform.
   */
  at: string | null;
  /** True when this number is the wrong side of zero and needs attention. */
  alarming: boolean;
}

export interface JobHealth {
  key: JobKey;
  name: string;
  what: string;
  /** Human schedule, already in Africa/Johannesburg. */
  schedule: string;
  /** How stale a heartbeat may get before it means something is wrong. */
  staleAfterMinutes: number;
  status: "not_configured" | "never_observed" | "stale" | "ok";
  lastRun: JobHeartbeat | null;
  evidence: JobEvidence[];
  /** Set on the billing run when CRON_SECRET gives it a second path. */
  fallback: string | null;
}

export interface ScheduledJobsHealth {
  config: InngestConfig;
  cronFallback: boolean;
  jobs: JobHealth[];
  /** Set when the evidence queries could not run; the rest still renders. */
  evidenceError: string | null;
}

const JOB_SHAPE: {
  key: JobKey;
  name: string;
  what: string;
  schedule: string;
  staleAfterMinutes: number;
}[] = [
  {
    key: "billing-run",
    name: "Nightly billing run",
    what: "Issues recurring invoices, runs dunning and suspensions, finalises cancellations.",
    schedule: "Daily at 02:00 SAST",
    // A day plus most of another: a single missed night is already the thing
    // we care about, but a run that starts at 02:00 and finishes at 02:06
    // must not read as late the next evening.
    staleAfterMinutes: 26 * 60,
  },
  {
    key: "outbox-drain",
    name: "Outbox drain",
    what: "Forwards domain events the inline post-commit send did not manage to deliver.",
    schedule: "Every 5 minutes",
    staleAfterMinutes: 30,
  },
  {
    key: "abandoned-signups",
    name: "Abandoned signup capture",
    what: "Turns signups that stalled after the contact step into leads for sales.",
    schedule: "Hourly",
    staleAfterMinutes: 4 * 60,
  },
];

/**
 * Everything the admin Integrations tab needs to say honestly whether the
 * scheduled work is running. Never throws: a broken evidence query degrades to
 * `evidenceError` so the configuration half, which is the half that diagnoses
 * the current outage, still renders.
 */
export async function scheduledJobsHealth(): Promise<ScheduledJobsHealth> {
  const config = inngestConfig();
  const cronFallback = cronFallbackConfigured();

  let heartbeats: HeartbeatMap = {};
  let evidence: Record<JobKey, JobEvidence[]> = {
    "billing-run": [],
    "outbox-drain": [],
    "abandoned-signups": [],
  };
  let evidenceError: string | null = null;

  try {
    [heartbeats, evidence] = await Promise.all([
      readHeartbeats(),
      gatherEvidence(),
    ]);
  } catch (err) {
    evidenceError =
      err instanceof Error ? err.message : "Could not read the database";
  }

  const now = Date.now();
  const jobs: JobHealth[] = JOB_SHAPE.map((shape) => {
    const lastRun = heartbeats[shape.key] ?? null;
    const hasPath =
      config.ready || (shape.key === "billing-run" && cronFallback);

    let status: JobHealth["status"];
    if (!hasPath) {
      status = "not_configured";
    } else if (!lastRun) {
      status = "never_observed";
    } else {
      const age = now - new Date(lastRun.at).getTime();
      status =
        Number.isNaN(age) || age > shape.staleAfterMinutes * 60_000
          ? "stale"
          : "ok";
    }

    return {
      ...shape,
      status,
      lastRun,
      evidence: evidence[shape.key],
      fallback:
        shape.key === "billing-run"
          ? cronFallback
            ? "Vercel Cron also calls /api/cron/billing at 02:40 SAST, so this run survives Inngest being down."
            : "No fallback: set CRON_SECRET to give this run a second path that does not depend on Inngest."
          : null,
    };
  });

  return { config, cronFallback, jobs, evidenceError };
}

/**
 * The corroborating facts, all read from rows the jobs already write or drain.
 * Each one names its own source in `label`, because a number on an ops screen
 * that you cannot trace back to a table is a number nobody will trust at 3am.
 */
async function gatherEvidence(): Promise<Record<JobKey, JobEvidence[]>> {
  const today = todayInJohannesburg();
  const now = new Date();

  const [
    overdueServices,
    lastRecurringInvoice,
    dueAttempts,
    unforwarded,
    oldestUnforwarded,
    lastForwarded,
    lastAbandonedLead,
  ] = await Promise.all([
    // Services whose billing pointer is in the past. On a healthy platform
    // this is zero every morning: the run invoices them and moves the pointer
    // on. Anything above zero is money that should already be on an invoice.
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(services)
      .where(
        and(
          inArray(services.status, ["active", "suspended"]),
          lt(services.nextInvoiceDate, today)
        )
      ),
    // Newest recurring invoice. Order invoices carry an order_id and no
    // period, so filtering on service_id plus period_start isolates the ones
    // the nightly run produced from the month-one invoice the PayFast webhook
    // writes inline.
    db
      .select({ issueDate: invoices.issueDate, number: invoices.number })
      .from(invoices)
      .where(and(isNotNull(invoices.serviceId), isNotNull(invoices.periodStart)))
      .orderBy(desc(invoices.issueDate))
      .limit(1),
    // Collection attempts whose slot has come and gone unexecuted: dunning is
    // scheduled but nothing is running it.
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(collectionAttempts)
      .where(
        and(
          lte(collectionAttempts.scheduledFor, now),
          isNull(collectionAttempts.executedAt)
        )
      ),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(domainEvents)
      .where(isNull(domainEvents.forwardedAt)),
    db
      .select({ createdAt: domainEvents.createdAt })
      .from(domainEvents)
      .where(isNull(domainEvents.forwardedAt))
      .orderBy(asc(domainEvents.createdAt))
      .limit(1),
    db
      .select({ forwardedAt: domainEvents.forwardedAt })
      .from(domainEvents)
      .where(isNotNull(domainEvents.forwardedAt))
      .orderBy(desc(domainEvents.forwardedAt))
      .limit(1),
    db
      .select({ createdAt: leads.createdAt })
      .from(leads)
      .where(eq(leads.source, "web_abandoned"))
      .orderBy(desc(leads.createdAt))
      .limit(1),
  ]);

  const overdueCount = overdueServices[0]?.n ?? 0;
  const dueAttemptCount = dueAttempts[0]?.n ?? 0;
  const unforwardedCount = unforwarded[0]?.n ?? 0;

  return {
    "billing-run": [
      {
        label: "Active or suspended services whose next_invoice_date is already past",
        value: String(overdueCount),
        at: null,
        alarming: overdueCount > 0,
      },
      {
        label: "Newest recurring invoice (invoices.issue_date, service and period set)",
        value: lastRecurringInvoice[0]
          ? `${lastRecurringInvoice[0].number} issued ${lastRecurringInvoice[0].issueDate}`
          : "none issued yet",
        at: null,
        alarming: false,
      },
      {
        label: "Collection attempts past their scheduled_for with no executed_at",
        value: String(dueAttemptCount),
        at: null,
        alarming: dueAttemptCount > 0,
      },
    ],
    "outbox-drain": [
      {
        label: "domain_events rows with no forwarded_at",
        value: String(unforwardedCount),
        at: null,
        alarming: unforwardedCount > 0,
      },
      {
        label: "Oldest unforwarded event",
        value: "none waiting",
        at: oldestUnforwarded[0]?.createdAt?.toISOString() ?? null,
        alarming: unforwardedCount > 0,
      },
      {
        label: "Newest forwarded_at",
        value: "nothing has ever been forwarded",
        at: lastForwarded[0]?.forwardedAt?.toISOString() ?? null,
        alarming: !lastForwarded[0]?.forwardedAt,
      },
    ],
    "abandoned-signups": [
      {
        label: "Newest lead with source web_abandoned",
        value: "none captured yet",
        at: lastAbandonedLead[0]?.createdAt?.toISOString() ?? null,
        // Absence here is not proof of a fault. Nobody may have abandoned a
        // signup, which is a good outcome, so this reports without alarming.
        alarming: false,
      },
      {
        label: "Why there is no backlog number here",
        value:
          "A draft only becomes eligible six hours after it stalls, and capture marks the draft itself, so this job leaves no queue to measure. The heartbeat above is the evidence that matters.",
        at: null,
        alarming: false,
      },
    ],
  };
}
