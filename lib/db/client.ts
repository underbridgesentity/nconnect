import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Single server-side database client over the Supabase connection pooler
 * (or local Postgres in dev). Never imported from client components, * enforced by the `server-only` import.
 */
import "server-only";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

// Supabase transaction pooler does not support PREPARE. The client is
// cached on globalThis in dev so hot reloads don't leak connection pools.
const globalForDb = globalThis as unknown as {
  __ncPgClient?: ReturnType<typeof postgres>;
};

/**
 * Serverless connection hygiene, learned the hard way.
 *
 * Every function instance keeps its own pool, and a frozen or killed instance
 * cannot close it. The pooler then holds those backends in ClientRead waiting
 * for a client that is never coming back, so the slots leak. With no idle
 * timeout they leaked permanently: sessions were found still parked on a
 * finished query eight minutes later while live requests queued behind them
 * for a connection that never came, which is why pages hung indefinitely
 * rather than erroring. The database was never slow; its worst statement on
 * record is 212ms.
 *
 * max is NOT a throughput dial here, it is a correctness constraint, which
 * cost a day to learn. Supabase's pooler runs in transaction mode, which does
 * not support pipelining several queries down one connection. postgres.js
 * pipelines exactly that way once every connection is busy, and against
 * Supavisor those queued queries never come back at all. Measured in
 * production against this database: on a pool of 3, two concurrent queries
 * answered in 16ms and three in 22ms, while four never answered; on a pool of
 * 12, eight concurrent answered in 43ms. The same fan-out on plain local
 * Postgres is 1ms at any width, so this is Supavisor's behaviour, not ours.
 *
 * The rule that follows: `max` must exceed the largest number of queries any
 * single request fires concurrently. The widest today is the admin billing
 * page at eight in one Promise.all. If a page ever needs more than this, raise
 * this number in the same change, or the page will hang rather than run slow,
 * and it will hang silently: a query stuck in the client's own queue never
 * reaches the server, so statement_timeout cannot save it.
 */
const client =
  globalForDb.__ncPgClient ??
  postgres(connectionString, {
    prepare: false,
    // Comfortably above the widest fan-out (8), with headroom. Wide pools are
    // affordable because idle_timeout hands the slots straight back: the free
    // tier allows 200 pooler clients, and an instance between requests holds
    // none of them.
    max: 12,
    // Hand connections back to the pooler quickly; an instance between
    // requests should be holding nothing at all.
    idle_timeout: 20,
    // Recycle even busy connections, so a half-dead socket cannot be reused
    // forever after a pooler restart or a network blip.
    max_lifetime: 60 * 10,
    // Fail fast instead of hanging when the pool has nothing to give. A 500
    // an operator can see beats a page that spins until the browser gives up.
    connect_timeout: 10,
    // Backstop against a genuinely runaway query taking an instance down
    // with it. Well above normal (worst real query: 20ms), well below the
    // function timeout, so we surface the error ourselves.
    connection: { statement_timeout: 15_000 },
  });
if (process.env.NODE_ENV !== "production") {
  globalForDb.__ncPgClient = client;
}

export const db = drizzle(client, { schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export { schema };
