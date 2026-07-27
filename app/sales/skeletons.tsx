import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Shared shapes for the sales `loading.tsx` files.
 *
 * Sales is its own visual language: 44px pill search rows, pill filter
 * strips and `rounded-2xl` cards, all of it built for a thumb. These match
 * that, not the admin tables, so a rep sees the page they are about to get
 * rather than a generic grey block that reflows underneath them.
 *
 * Static markup only. A loading file that does work defeats its own purpose.
 */

/** One polite announcement for the whole screen, not one per block. */
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

/** Title plus the one-line description each sales screen carries. */
export function HeaderSkeleton({ subtitle = true }: { subtitle?: boolean }) {
  return (
    <div className="space-y-2">
      <Skeleton className="h-7 w-48" />
      {subtitle ? <Skeleton className="h-4 w-72 max-w-full" /> : null}
    </div>
  );
}

/** The 44px search field with its Search button, as used on every list. */
export function SearchRowSkeleton() {
  return (
    <div className="flex flex-wrap gap-2">
      <Skeleton className="h-11 min-w-48 flex-1 rounded-full" />
      <Skeleton className="h-11 w-24 rounded-full" />
    </div>
  );
}

/** A strip of scope or status pills. */
export function PillRowSkeleton({ count }: { count: number }) {
  const widths = ["w-20", "w-28", "w-24", "w-20", "w-32", "w-24"];
  return (
    <div className="flex flex-wrap gap-1.5">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton
          key={i}
          className={cn("h-11 rounded-full", widths[i % widths.length])}
        />
      ))}
    </div>
  );
}

/** The stack of `rounded-2xl` record cards used by every sales list. */
export function CardListSkeleton({
  rows = 4,
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
          className="flex items-center justify-between gap-3 rounded-2xl border bg-card p-4"
        >
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-36 max-w-full" />
            <Skeleton className="h-3 w-52 max-w-full" />
          </div>
          <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
        </div>
      ))}
    </div>
  );
}
