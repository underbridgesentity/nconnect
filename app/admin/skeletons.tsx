import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Shared shapes for the admin `loading.tsx` files.
 *
 * Every admin screen is a header, then a tab strip or a filter row, then a
 * table or a stack of cards. Building those four shapes once keeps each
 * loading file to a handful of lines and, more importantly, keeps the
 * skeletons the same height as the real thing, so the page does not jump when
 * the queries land.
 *
 * Everything here is static markup. A loading file must never do work of its
 * own: it is the thing that is supposed to render before any work happens.
 */

/**
 * One announcement for the whole screen. Screen readers get a single polite
 * "Loading customers" rather than one message per skeleton block, and the
 * busy state is on the region that is actually pending.
 */
export function LoadingShell({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-6", className)} aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading {label}</span>
      {children}
    </div>
  );
}

/** Title plus the one-line description every admin page carries. */
export function HeaderSkeleton({ subtitle = true }: { subtitle?: boolean }) {
  return (
    <div className="space-y-2">
      <Skeleton className="h-7 w-44" />
      {subtitle ? <Skeleton className="h-4 w-72 max-w-full" /> : null}
    </div>
  );
}

/** The underlined tab strip on Billing, Catalogue and Reports. */
export function TabStripSkeleton({ count }: { count: number }) {
  return (
    <div className="flex h-11 items-center gap-6 border-b">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-4 w-16 shrink-0" />
      ))}
    </div>
  );
}

/** The search box that sits above most admin lists. */
export function SearchSkeleton({ className }: { className?: string }) {
  return (
    <Skeleton
      className={cn(
        "h-8 w-full max-w-md rounded-lg pointer-coarse:h-11",
        className
      )}
    />
  );
}

/** A row of filter or jump pills, matching `filterPillClass` heights. */
export function PillRowSkeleton({
  count,
  size = "default",
}: {
  count: number;
  size?: "default" | "sm";
}) {
  const widths = ["w-16", "w-24", "w-20", "w-28", "w-16", "w-24", "w-32", "w-20"];
  return (
    <div className="flex flex-wrap gap-1.5">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton
          key={i}
          className={cn(
            "rounded-full pointer-coarse:h-11",
            size === "sm" ? "h-7" : "h-8",
            widths[i % widths.length]
          )}
        />
      ))}
    </div>
  );
}

/** A bordered data table: sticky-looking head row, then body rows. */
export function TableSkeleton({
  columns,
  rows = 8,
}: {
  columns: number;
  rows?: number;
}) {
  const widths = ["w-32", "w-24", "w-20", "w-16", "w-28", "w-20", "w-16"];
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="flex items-center gap-4 border-b px-3 py-3.5">
        {Array.from({ length: columns }, (_, i) => (
          <Skeleton key={i} className="h-3 w-16 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div
          key={r}
          className="flex items-center gap-4 border-b px-3 py-4 last:border-0"
        >
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton
              key={c}
              className={cn("h-4 flex-1", widths[(r + c) % widths.length])}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** The stack of bordered cards used by Today's queue sections. */
export function CardListSkeleton({
  rows = 3,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="flex items-center justify-between gap-3 rounded-lg border bg-card p-4"
        >
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-40 max-w-full" />
            <Skeleton className="h-3 w-56 max-w-full" />
          </div>
          <Skeleton className="h-4 w-16 shrink-0" />
        </div>
      ))}
    </div>
  );
}

/** A queue section: heading, then either cards or an empty-state box. */
export function SectionSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <section className="space-y-2">
      <Skeleton className="h-4 w-48 max-w-full" />
      <CardListSkeleton rows={rows} />
    </section>
  );
}
