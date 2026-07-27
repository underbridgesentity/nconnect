import { Skeleton } from "@/components/ui/skeleton";
import { CardListSkeleton, LoadingShell } from "../../skeletons";

/**
 * Lead detail loading state. Without its own file this would inherit the
 * leads-list skeleton, so a rep opening a lead would watch a quick-add card
 * and a filter strip draw themselves and then vanish.
 */
export default function SalesLeadLoading() {
  return (
    <LoadingShell label="this lead">
      <div className="space-y-2">
        <Skeleton className="h-7 w-24 rounded-full" />
        <Skeleton className="h-8 w-52 max-w-full" />
        <Skeleton className="h-4 w-60 max-w-full" />
      </div>
      <Skeleton className="h-11 w-full rounded-2xl" />
      <section className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <CardListSkeleton rows={2} />
      </section>
      <section className="space-y-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-28 w-full rounded-2xl" />
      </section>
    </LoadingShell>
  );
}
