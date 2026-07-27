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

      {/*
        Quick add, the card a rep types into mid-conversation. Drawn as the
        real wrapping row rather than one tall block, so it reflows to the same
        height the form will occupy and the search box below it does not jump
        under a thumb that is already moving.
      */}
      <div className="space-y-2 rounded-2xl border bg-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-8 w-36 flex-1 rounded-lg pointer-coarse:h-11" />
          <Skeleton className="h-8 w-36 flex-1 rounded-lg pointer-coarse:h-11" />
          <Skeleton className="h-8 w-40 flex-1 rounded-lg pointer-coarse:h-11" />
          <Skeleton className="hidden h-8 flex-1 rounded-lg pointer-coarse:h-11 sm:block" />
          <Skeleton className="h-11 w-28 rounded-full" />
        </div>
        <Skeleton className="h-3 w-80 max-w-full" />
      </div>

      <SearchRowSkeleton />
      <PillRowSkeleton count={3} />
      <PillRowSkeleton count={6} />
      <CardListSkeleton rows={6} />
    </LoadingShell>
  );
}
