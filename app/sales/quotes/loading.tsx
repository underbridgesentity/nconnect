import { Skeleton } from "@/components/ui/skeleton";
import {
  CardListSkeleton,
  HeaderSkeleton,
  LoadingShell,
  SearchRowSkeleton,
} from "../skeletons";

/**
 * Quotes list loading state. Each row resolves its effective status, expiry
 * and linked order before it can be drawn, so the New quote button and the
 * search row appearing first is what makes the tap feel answered.
 */
export default function SalesQuotesLoading() {
  return (
    <LoadingShell label="quotes">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <HeaderSkeleton />
        <Skeleton className="h-11 w-36 rounded-full" />
      </div>
      <SearchRowSkeleton />
      <CardListSkeleton rows={6} />
    </LoadingShell>
  );
}
