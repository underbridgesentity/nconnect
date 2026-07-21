"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Scroll-reveal wrapper (spec §11 motion rules): a single 500ms ease-out
 * fade-and-rise as sections enter the viewport, staggered via `delay`.
 * Implemented with IntersectionObserver plus a scroll-position fallback so
 * content can never be left invisible, and prefers-reduced-motion renders
 * statically (the global CSS also zeroes transitions).
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
      className={className}
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? "none" : `translateY(${y}px)`,
        transition: `opacity 500ms cubic-bezier(0.21,0.65,0.36,1) ${delay}s, transform 500ms cubic-bezier(0.21,0.65,0.36,1) ${delay}s`,
      }}
    >
      {children}
    </div>
  );
}
