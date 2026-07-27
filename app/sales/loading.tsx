import { Skeleton } from "@/components/ui/skeleton";
import { CardListSkeleton, HeaderSkeleton, LoadingShell } from "./skeletons";

/**
 * Pipeline loading state. The home screen counts leads by status, finds
 * expiring quotes, lists what is awaiting a response and works out this
 * month's commission, which is five round trips before anything renders. On a
 * phone on mobile data that is a long stare at an unchanged screen.
 */
export default function SalesHomeLoading() {
  return (
    <LoadingShell label="your pipeline">
      <HeaderSkeleton />

      {/* Lead counts by status. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="space-y-2 rounded-2xl border bg-card p-3">
            <Skeleton className="h-3 w-16 max-w-full" />
            <Skeleton className="h-7 w-10" />
          </div>
        ))}
      </div>

      <section className="space-y-2">
        <Skeleton className="h-4 w-48 max-w-full" />
        <CardListSkeleton rows={3} />
      </section>

      <section className="space-y-3 rounded-2xl border bg-card p-4">
        <Skeleton className="h-4 w-24" />
        <div className="grid grid-cols-2 gap-4">
          {[0, 1].map((i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-28 max-w-full" />
              <Skeleton className="h-7 w-20" />
            </div>
          ))}
        </div>
      </section>
    </LoadingShell>
  );
}
