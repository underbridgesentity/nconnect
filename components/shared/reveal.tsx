"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Scroll-reveal wrapper (spec §11 motion rules): a single 500ms ease-out
 * fade-and-rise as sections enter the viewport, staggered via `delay`.
 *
 * Progressive enhancement: the hidden state lives in CSS behind `.js`, which
 * the inline head script adds. The server HTML is therefore fully visible,
 * which matters because public pages must render complete HTML server-side
 * and because crawlers and no-JS visitors must never see a blank page.
 *
 * `className` lands on this wrapper, so grid/flex child classes (col-span,
 * h-full) applied by callers actually take effect on the real grid child.
 */
export function Reveal({
  children,
  delay = 0,
  className,
  y = 24,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  y?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const show = () => setShown(true);
    if (
      typeof IntersectionObserver === "undefined" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      const raf = requestAnimationFrame(show);
      return () => cancelAnimationFrame(raf);
    }
    const check = () => {
      const rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight - 32) show();
    };
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          show();
          io.disconnect();
        }
      },
      { threshold: 0.08 }
    );
    io.observe(el);
    const raf = requestAnimationFrame(check);
    window.addEventListener("scroll", check, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener("scroll", check);
    };
  }, []);

  return (
    <div
      ref={ref}
      className={cn("reveal", className)}
      data-shown={shown ? "true" : "false"}
      style={
        {
          "--reveal-y": `${y}px`,
          "--reveal-delay": `${delay}s`,
        } as React.CSSProperties
      }
    >
      {children}
    </div>
  );
}
