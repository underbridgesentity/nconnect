"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Pause, Play } from "lucide-react";

/**
 * Live updates for a support thread, with the two things a blanket
 * setInterval cannot give you:
 *
 * - a pause control (WCAG 2.2.2), because a refresh every few seconds throws
 *   a screen reader or a magnifier user out of their reading position;
 * - a visibility check, so a portal left open in the background stops
 *   spending a prepaid customer's data and battery on polls nobody is reading.
 */
export function LiveUpdates({ seconds = 15 }: { seconds?: number }) {
  const router = useRouter();
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;

    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const id = setInterval(tick, seconds * 1000);

    // Coming back to the tab should show the latest immediately rather than
    // waiting out the rest of the interval.
    const onVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, seconds, paused]);

  return (
    <button
      type="button"
      onClick={() => setPaused((value) => !value)}
      aria-pressed={paused}
      className="inline-flex touch-target items-center gap-1.5 rounded-full px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {paused ? (
        <>
          <Play className="size-3.5" aria-hidden />
          Resume live updates
        </>
      ) : (
        <>
          <Pause className="size-3.5" aria-hidden />
          Pause live updates
        </>
      )}
    </button>
  );
}
