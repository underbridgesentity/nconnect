import type { NextRequest } from "next/server";
import postgres from "postgres";
import { db } from "@/lib/db/client";
import { gateCronRequest, cronJson } from "@/lib/jobs/cron-auth";
import { sql } from "drizzle-orm";

/**
 * Where does a request actually spend its time before it reaches Postgres?
 *
 * Built during the 2026-08-17 hang, when admin pages stalled indefinitely
 * while the database sat idle: worst statement on record 212ms, almost no
 * backends, no locks, no deadlocks. That combination means the query is not
 * the problem and the path to the query is, but nothing in the stack was
 * reporting on that path. Timing the three stages separately is the whole
 * point:
 *
 *   connect  a brand new connection, so DNS, TCP, TLS and pooler handover are
 *            measured on their own rather than hidden behind a warm pool
 *   pooled   the shared application pool, which is the one real pages use and
 *            the one that can be starved by connections nobody released
 *   query    trivial server-side work, as the control
 *
 * A large connect with a small query says the pooler or the network is the
 * bottleneck. A large pooled with a small connect says our own pool is
 * starved. Both small says the fault is not the database at all.
 *
 * Behind the cron secret because it reports infrastructure timings and opens
 * a connection on demand, so it is not something to leave open to the world.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Time a stage, but never let it outlive its own deadline.
 *
 * The first version of this probe had no deadline and told us nothing: a
 * stage hung, the whole function hit FUNCTION_INVOCATION_TIMEOUT, and the
 * response that would have said which stage hung died with it. A probe that
 * can hang is not a probe. Each stage now gets a hard ceiling, so "this one
 * never came back" is itself the finding.
 */
async function timed<T>(
  fn: () => Promise<T>,
  deadlineMs = 8_000
): Promise<[number, T | string]> {
  const started = Date.now();
  try {
    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`no answer within ${deadlineMs}ms`)),
          deadlineMs
        )
      ),
    ]);
    return [Date.now() - started, result];
  } catch (err) {
    return [
      Date.now() - started,
      `FAILED: ${err instanceof Error ? err.message : String(err)}`,
    ];
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  const gate = gateCronRequest(req, "the database health probe");
  if (!gate.ok) return gate.response;

  const url = process.env.DATABASE_URL ?? "";
  let host = "(unparseable)";
  let port = "";
  try {
    const parsed = new URL(url);
    host = parsed.hostname;
    port = parsed.port;
  } catch {
    // Leave the placeholder; the shape of the URL is not worth leaking.
  }

  // Does raw TCP to the pooler even answer? Separates "cannot reach the host"
  // from "reached it and then stalled", which no Postgres-level timing can.
  const [tcpMs, tcpResult] = await timed(async () => {
    const { Socket } = await import("node:net");
    return new Promise<string>((resolve, reject) => {
      const socket = new Socket();
      socket.setTimeout(6_000);
      socket.once("connect", () => {
        socket.destroy();
        resolve("connected");
      });
      socket.once("timeout", () => {
        socket.destroy();
        reject(new Error("tcp timeout"));
      });
      socket.once("error", (e) => {
        socket.destroy();
        reject(e);
      });
      socket.connect(Number(port || 5432), host);
    });
  }, 7_000);

  // A fresh single-use client, closed in the finally, so this probe can never
  // become the thing that leaks a connection.
  const [connectMs, connectResult] = await timed(async () => {
    const solo = postgres(url, {
      prepare: false,
      max: 1,
      connect_timeout: 6,
      idle_timeout: 5,
      connection: { statement_timeout: 5_000 },
    });
    try {
      const rows = await solo`select 1 as ok`;
      return rows[0]?.ok ?? null;
    } finally {
      await solo.end({ timeout: 3 }).catch(() => {});
    }
  });

  const [pooledMs, pooledResult] = await timed(async () => {
    const rows = await db.execute(sql`select 1 as ok`);
    return Array.isArray(rows) ? (rows[0]?.ok ?? null) : "unexpected shape";
  });

  // Eight at once, matching what the heaviest admin page fires, to show
  // whether concurrency is where it falls over.
  const [fanOutMs, fanOutResult] = await timed(async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => db.execute(sql`select 1 as ok`))
    );
    return results.length;
  });

  return cronJson({
    ok: true,
    region: process.env.VERCEL_REGION ?? "(unknown)",
    database: { host, port },
    timingsMs: {
      tcpReach: tcpMs,
      freshConnect: connectMs,
      pooledQuery: pooledMs,
      eightConcurrent: fanOutMs,
    },
    results: {
      tcpReach: tcpResult,
      freshConnect: connectResult,
      pooledQuery: pooledResult,
      eightConcurrent: fanOutResult,
    },
  });
}
