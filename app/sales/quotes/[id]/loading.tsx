import { Skeleton } from "@/components/ui/skeleton";
import { LoadingShell } from "../../skeletons";

/**
 * Quote detail loading state. A rep usually lands here from a WhatsApp
 * notification, so this is a cold start with no warm cache: the quote, its
 * lines, the lead and the acceptance trail all have to arrive first.
 */
export default function SalesQuoteLoading() {
  return (
    <LoadingShell label="this quote">
      <div className="space-y-2">
        <Skeleton className="h-7 w-24 rounded-full" />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-4 w-48 max-w-full" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-11 w-28 rounded-full" />
          </div>
        </div>
      </div>

      {/* Quote lines and totals. */}
      <div className="space-y-3 rounded-2xl border bg-card p-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center justify-between gap-3">
            <Skeleton className="h-4 w-52 max-w-full" />
            <Skeleton className="h-4 w-20 shrink-0" />
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 border-t pt-3">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-5 w-24 shrink-0" />
        </div>
      </div>

      <section className="space-y-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </section>
    </LoadingShell>
  );
}
