import { Skeleton } from "@/components/ui/skeleton";
import { PillRowSkeleton, SearchSkeleton } from "../skeletons";

/**
 * Inbox loading state.
 *
 * The inbox is the one admin screen that is not a single column, so a generic
 * skeleton would collapse to full width and then snap into two panes. This
 * holds the real split: the 384px conversation rail on the left, the thread
 * card on the right, and the same fixed viewport height, so nothing reflows
 * when the queries land.
 */
export default function AdminInboxLoading() {
  return (
    <div
      className="mx-auto flex h-[calc(100dvh-6rem)] max-w-6xl flex-col gap-4 md:flex-row"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Loading the inbox</span>

      {/* Conversation rail */}
      <div className="flex w-full flex-col md:w-96">
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-7 w-24 rounded-full" />
        </div>
        <div className="mt-3">
          <SearchSkeleton className="max-w-none" />
        </div>
        <div className="mt-3 space-y-2">
          <PillRowSkeleton count={4} size="sm" />
          <PillRowSkeleton count={3} size="sm" />
          <PillRowSkeleton count={3} size="sm" />
        </div>
        <div className="mt-4 flex-1 space-y-1.5 overflow-hidden pr-1">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="space-y-2 rounded-lg border bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <Skeleton className="h-4 w-32 max-w-full" />
                <Skeleton className="h-4 w-14 shrink-0 rounded-full" />
              </div>
              <Skeleton className="h-3 w-48 max-w-full" />
            </div>
          ))}
        </div>
      </div>

      {/* Thread pane */}
      <div className="hidden min-w-0 flex-1 flex-col rounded-lg border bg-card md:flex">
        <div className="flex items-center justify-between gap-2 border-b p-3">
          <Skeleton className="h-4 w-40 max-w-full" />
          <Skeleton className="h-4 w-24 shrink-0" />
        </div>
        <div className="flex-1 space-y-3 p-4">
          <Skeleton className="h-14 w-2/3 rounded-lg" />
          <Skeleton className="ml-auto h-10 w-1/2 rounded-lg" />
          <Skeleton className="h-16 w-3/5 rounded-lg" />
        </div>
        <div className="border-t p-3">
          <Skeleton className="h-16 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}
