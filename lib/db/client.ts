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
 * max is deliberately small. A page that fires eight queries at once wants
 * eight connections, but each query costs single-digit milliseconds, so
 * queueing them over a few connections is far cheaper than pinning eight
 * pooler slots per instance across every warm instance Vercel keeps.
 */
const client =
  globalForDb.__ncPgClient ??
  postgres(connectionString, {
    prepare: false,
    max: 3,
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
