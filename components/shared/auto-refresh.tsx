"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Pause, Play } from "lucide-react";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Polling fallback for realtime (spec §10.2): with Supabase Realtime
 * configured, broadcasts land instantly; without it (local dev) this keeps
 * threads and queues fresh on a short interval.
 *
 * It has to be frugal, because it runs on capped South African mobile data
 * inside a portal people leave open:
 *  - nothing is fetched unless document.visibilityState is "visible", and a
 *    single catch-up refresh runs the moment the tab is looked at again,
 *  - nothing is fetched while the device reports itself offline, and the
 *    catch-up runs on the "online" event instead of on a wasted timer,
 *  - the interval stretches out while nobody is touching the page, so a tab
 *    left open in the background costs almost nothing,
 *  - Save Data starts at the slowest interval,
 *  - `control` renders a pause button and a polite live region, which is what
 *    WCAG 2.2.2 Pause, Stop, Hide asks for on auto-updating content.
 */

/** No interaction for this long and we start stretching the interval. */
const IDLE_STEP_MS = 60_000;
/** The slowest interval is this many times the caller's base interval. */
const MAX_BACKOFF = 8;
/**
 * Floor between two spoken "refreshed" announcements. A live region that fires
 * every five seconds makes a queue unusable with a screen reader, so the
 * region reports at most once a minute and stays silent in between.
 */
const ANNOUNCE_GAP_MS = 60_000;

type ConnectionLike = { saveData?: boolean };

export function AutoRefresh({
  seconds = 5,
  control = false,
  className,
}: {
  seconds?: number;
  /**
   * Render a visible pause toggle and a polite live region. Off by default so
   * existing call sites are unchanged.
   */
  control?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [paused, setPaused] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (paused) return;

    const base = Math.max(1, seconds) * 1000;
    const connection = (navigator as Navigator & { connection?: ConnectionLike })
      .connection;
    const saveData = connection?.saveData === true;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    let lastInteraction = Date.now();
    let lastAnnounced = Date.now();
    let missedWhileAway = false;
    let pendingDelay = base;

    /** Fetching is only worth the data when the tab is on screen and reachable. */
    const canFetch = () =>
      document.visibilityState === "visible" && navigator.onLine !== false;

    const nextDelay = () => {
      if (saveData) return base * MAX_BACKOFF;
      const idleFor = Date.now() - lastInteraction;
      if (idleFor < IDLE_STEP_MS) return base;
      const steps = Math.floor(idleFor / IDLE_STEP_MS) + 1;
      return base * Math.min(steps, MAX_BACKOFF);
    };

    const refresh = () => {
      router.refresh();
      if (!control) return;
      const now = Date.now();
      if (now - lastAnnounced < ANNOUNCE_GAP_MS) return;
      lastAnnounced = now;
      // "Refreshed", not "updated": a refresh does not promise that anything
      // actually changed, and the clock makes each announcement distinct so
      // assistive technology reads the repeat instead of swallowing it.
      setStatus(`Refreshed at ${formatTime(new Date())}.`);
    };

    const tick = () => {
      if (cancelled) return;
      if (canFetch()) {
        refresh();
      } else {
        // Nothing is on screen, or there is no connection to spend. Remember
        // that we skipped, so the catch-up runs the moment that changes.
        missedWhileAway = true;
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
      if (wasBackedOff && canFetch()) schedule();
    };

    // Someone reading a thread counts as active; someone who walked away does not.
    const activity = ["pointerdown", "keydown", "scroll", "focus"] as const;
    for (const name of activity) {
      window.addEventListener(name, noteInteraction, {
        passive: true,
        capture: true,
      });
    }

    /** Tab came back, or the signal did. Either way, catch up once. */
    const resume = () => {
      if (cancelled || !canFetch()) return;
      lastInteraction = Date.now();
      if (missedWhileAway) {
        missedWhileAway = false;
        refresh();
      }
      schedule();
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);

    schedule();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
      for (const name of activity) {
        window.removeEventListener(name, noteInteraction, { capture: true });
      }
    };
  }, [router, seconds, paused, control]);

  if (!control) return null;

  const toggle = () => {
    const next = !paused;
    setPaused(next);
    setStatus(
      next
        ? "Auto-updates paused. Reload the page to see new activity."
        : "Auto-updates resumed."
    );
  };

  return (
    <>
      <button
        type="button"
        onClick={toggle}
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
      {/*
       * Present from first render and empty, so the first message that lands in
       * it is announced. A region added to the DOM at the same moment as its
       * text is routinely missed by screen readers.
       */}
      <span role="status" aria-live="polite" className="sr-only">
        {status}
      </span>
    </>
  );
}
