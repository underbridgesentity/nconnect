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
const client =
  globalForDb.__ncPgClient ??
  postgres(connectionString, { prepare: false, max: 5 });
if (process.env.NODE_ENV !== "production") {
  globalForDb.__ncPgClient = client;
}

export const db = drizzle(client, { schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export { schema };
