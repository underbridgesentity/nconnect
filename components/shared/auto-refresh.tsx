"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Polling fallback for realtime (spec §10.2): with Supabase Realtime
 * configured, broadcasts land instantly; without it (local dev) this keeps
 * threads and queues fresh on a short interval.
 */
export function AutoRefresh({ seconds = 5 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
