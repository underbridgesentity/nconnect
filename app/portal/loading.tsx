import { Skeleton } from "@/components/ui/skeleton";

/**
 * Portal loading state. Without this, a tab tap blocks silently on the server
 * response and looks like nothing happened, so people tap again. The shell
 * (header, tab bar) stays put and only the content area fills in.
 */
export default function PortalLoading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      <Skeleton className="h-6 w-40" />
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-2xl border bg-card p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <Skeleton className="size-5 rounded-full" />
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <Skeleton className="mt-3 h-3 w-48" />
          </div>
        ))}
      </div>
    </div>
  );
}
