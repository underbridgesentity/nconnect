import { Skeleton } from "@/components/ui/skeleton";
import { CardListSkeleton, LoadingShell } from "../../skeletons";

/**
 * Sales customer detail loading state. Its own file so it does not inherit
 * the list skeleton, which would draw a search row that is about to disappear.
 */
export default function SalesCustomerLoading() {
  return (
    <LoadingShell label="this customer">
      <div className="space-y-2">
        <Skeleton className="h-7 w-32 rounded-full" />
        <Skeleton className="h-8 w-52 max-w-full" />
        <Skeleton className="h-4 w-60 max-w-full" />
      </div>
      <section className="space-y-2">
        <Skeleton className="h-4 w-20" />
        <CardListSkeleton rows={2} />
      </section>
      <section className="space-y-2">
        <Skeleton className="h-4 w-24" />
        <CardListSkeleton rows={2} />
      </section>
    </LoadingShell>
  );
}
