import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Realtime (spec §10.2): the server broadcasts after writes on scoped
 * channels, `user:{id}` (bell), `conversation:{id}` (threads),
 * `admin:inbox` (staff). Clients subscribe with narrowly scoped tokens
 * minted server-side; they never see service keys.
 *
 * Without Supabase configured (local dev) broadcasts are no-ops and the
 * UI's polling fallback (short refresh interval) keeps things live-ish, * recorded in PROGRESS.md per §16.10.
 */

function supabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function broadcast(
  channel: string,
  event: string,
  payload: Record<string, unknown>
): Promise<void> {
  const client = supabase();
  if (!client) return; // dev fallback: polling
  try {
    const ch = client.channel(channel);
    await ch.send({ type: "broadcast", event, payload });
    await client.removeChannel(ch);
  } catch (err) {
    console.error(`realtime broadcast failed (${channel}/${event}):`, err);
  }
}

export function realtimeConfigured(): boolean {
  return Boolean(
    process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}
