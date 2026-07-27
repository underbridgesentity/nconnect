"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Polling fallback for realtime (spec §10.2): with Supabase Realtime
 * configured, broadcasts land instantly; without it (local dev) this keeps
 * threads and queues fresh on a short interval.
 *
 * It has to be frugal, because it runs on capped South African mobile data
 * inside a portal people leave open:
 *  - nothing is fetched while the tab is hidden, and a single catch-up refresh
 *    runs the moment the tab is looked at again,
 *  - the interval stretches out while nobody is touching the page, so a tab
 *    left open in the background costs almost nothing,
 *  - Save Data starts at the slowest interval,
 *  - `control` renders a pause button, which is what WCAG 2.2.2 Pause, Stop,
 *    Hide asks for on auto-updating content.
 */

/** No interaction for this long and we start stretching the interval. */
const IDLE_STEP_MS = 60_000;
/** The slowest interval is this many times the caller's base interval. */
const MAX_BACKOFF = 8;

type ConnectionLike = { saveData?: boolean };

export function AutoRefresh({
  seconds = 5,
  control = false,
  className,
}: {
  seconds?: number;
  /** Render a visible pause toggle. Off by default so call sites are unchanged. */
  control?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;

    const base = Math.max(1, seconds) * 1000;
    const connection = (navigator as Navigator & { connection?: ConnectionLike })
      .connection;
    const saveData = connection?.saveData === true;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    let lastInteraction = Date.now();
    let missedWhileHidden = false;
    let pendingDelay = base;

    const nextDelay = () => {
      if (saveData) return base * MAX_BACKOFF;
      const idleFor = Date.now() - lastInteraction;
      if (idleFor < IDLE_STEP_MS) return base;
      const steps = Math.floor(idleFor / IDLE_STEP_MS) + 1;
      return base * Math.min(steps, MAX_BACKOFF);
    };

    const tick = () => {
      if (cancelled) return;
      if (document.hidden) {
        // Nothing is on screen, so nothing needs fetching. Remember that we
        // skipped, so the catch-up runs the moment the tab comes back.
        missedWhileHidden = true;
      } else {
        router.refresh();
      }
      schedule();
    };

    const schedule = () => {
      if (cancelled) return;
      if (timer) clearTimeout(timer);
      pendingDelay = nextDelay();
      timer = setTimeout(tick, pendingDelay);
    };

    const noteInteraction = () => {
      // Coming back to a page that had backed off must not leave the customer
      // waiting out the long timer that is already in flight.
      const wasBackedOff = pendingDelay > base;
      lastInteraction = Date.now();
      if (wasBackedOff && !document.hidden) schedule();
    };

    // Someone reading a thread counts as active; someone who walked away does not.
    const activity = ["pointerdown", "keydown", "scroll", "focus"] as const;
    for (const name of activity) {
      window.addEventListener(name, noteInteraction, {
        passive: true,
        capture: true,
      });
    }

    const onVisibilityChange = () => {
      if (cancelled || document.hidden) return;
      lastInteraction = Date.now();
      if (missedWhileHidden) {
        missedWhileHidden = false;
        router.refresh();
      }
      schedule();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    schedule();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      for (const name of activity) {
        window.removeEventListener(name, noteInteraction, { capture: true });
      }
    };
  }, [router, seconds, paused]);

  if (!control) return null;

  return (
    <button
      type="button"
      onClick={() => setPaused((value) => !value)}
      aria-pressed={paused}
      className={cn(
        "touch-target inline-flex items-center gap-1.5 rounded-full px-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground",
        className
      )}
    >
      {paused ? (
        <Play className="size-3.5" aria-hidden />
      ) : (
        <Pause className="size-3.5" aria-hidden />
      )}
      {paused ? "Resume auto-updates" : "Pause auto-updates"}
    </button>
  );
}
