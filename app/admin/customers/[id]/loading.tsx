import { Skeleton } from "@/components/ui/skeleton";
import { CardListSkeleton, LoadingShell, TabStripSkeleton } from "../../skeletons";

/**
 * Customer 360 loading state.
 *
 * Opening a customer from the list is the single most common admin action,
 * and this page pulls services, plans, providers, invoices, payments, orders,
 * conversations, RICA and the audit trail in one go. Without its own file it
 * would inherit the customers-list table skeleton, which is the wrong shape
 * and would flash a table where a detail page is about to appear.
 */
export default function AdminCustomerLoading() {
  return (
    <LoadingShell label="this customer" className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-28 rounded-full" />
          <Skeleton className="h-8 w-56 max-w-full" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
        <div className="flex items-center gap-4">
          <div className="space-y-2 text-right">
            <Skeleton className="ml-auto h-3 w-20" />
            <Skeleton className="ml-auto h-5 w-24" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-8 w-24 rounded-full" />
        </div>
      </div>

      {/* The fact strip an operator reads before picking up the phone. */}
      <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-2xl border bg-card px-4 py-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-4 w-24" />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-8 w-44 rounded-lg" />
      </div>

      <TabStripSkeleton count={7} />
      <CardListSkeleton rows={4} />
    </LoadingShell>
  );
}
