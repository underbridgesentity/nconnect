import { Skeleton } from "@/components/ui/skeleton";
import { LoadingShell } from "../../skeletons";

/**
 * New quote loading state. The builder needs the whole catalogue plus the
 * discount ceilings before a rep can add a line, and this is normally opened
 * from a lead while the customer is still on the phone.
 */
export default function SalesNewQuoteLoading() {
  return (
    <LoadingShell label="the quote builder" className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-7 w-24 rounded-full" />
        <Skeleton className="h-8 w-48" />
      </div>
      <div className="space-y-3 rounded-2xl border bg-card p-4">
        <Skeleton className="h-11 w-full rounded-lg" />
        <Skeleton className="h-11 w-full rounded-lg" />
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-11 w-32 rounded-full" />
          <Skeleton className="h-11 w-28 rounded-full" />
        </div>
      </div>
      <Skeleton className="h-40 w-full rounded-2xl" />
    </LoadingShell>
  );
}
