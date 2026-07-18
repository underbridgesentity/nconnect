import "server-only";
import { sql } from "drizzle-orm";
import { type Tx } from "@/lib/db/client";

/**
 * Gap-free per-year number sequences (spec §10.5): NC- orders, INV- invoices,
 * Q- quotes. Uses an upsert with row lock inside the caller's transaction so
 * concurrent checkouts can't collide.
 */
export async function nextNumber(
  tx: Tx,
  prefix: "NC" | "INV" | "Q",
  now = new Date()
): Promise<string> {
  const year = now.getFullYear();
  const result = await tx.execute(sql`
    insert into number_sequences (prefix, year, last_value)
    values (${prefix}, ${year}, 1)
    on conflict (prefix, year)
    do update set last_value = number_sequences.last_value + 1
    returning last_value
  `);
  const rows = result as unknown as { last_value: number }[];
  const value = rows[0].last_value;
  return `${prefix}-${year}-${String(value).padStart(5, "0")}`;
}
