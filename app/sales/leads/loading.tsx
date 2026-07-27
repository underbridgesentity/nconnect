import { Skeleton } from "@/components/ui/skeleton";
import {
  CardListSkeleton,
  HeaderSkeleton,
  LoadingShell,
  PillRowSkeleton,
  SearchRowSkeleton,
} from "../skeletons";

/**
 * Leads loading state. The list runs a search, a status histogram and the
 * unclaimed-pool count together, and the quick-add card sits above all of it,
 * so the shape has to hold or the search box jumps down the screen mid-tap.
 */
export default function SalesLeadsLoading() {
  return (
    <LoadingShell label="leads">
      <HeaderSkeleton />
      {/* Quick add, the card a rep types into mid-conversation. */}
      <Skeleton className="h-28 w-full rounded-2xl" />
      <SearchRowSkeleton />
      <PillRowSkeleton count={3} />
      <PillRowSkeleton count={6} />
      <CardListSkeleton rows={6} />
    </LoadingShell>
  );
}
