import { Skeleton } from "@/components/ui/skeleton";
import { LoadingShell, PillRowSkeleton, SectionSkeleton } from "./skeletons";

/**
 * Today's loading state.
 *
 * Today runs roughly ten queries across provisioning, invoices, collections,
 * conversations, feasibility, RICA and stock before it can render a single
 * pixel. Until this existed, opening the workspace looked like the click had
 * not registered, so operators clicked again. The strip, the jump list and the
 * first sections are drawn at their real heights, so nothing shifts when the
 * queue lands.
 */
export default function AdminTodayLoading() {
  return (
    <LoadingShell label="Today" className="mx-auto max-w-4xl space-y-8">
      <div className="space-y-2">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-4 w-56 max-w-full" />
      </div>

      {/* Slim strip: active services, MRR, open conversations. */}
      <div className="grid grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-2 rounded-lg border bg-card p-3">
            <Skeleton className="h-3 w-20 max-w-full" />
            <Skeleton className="h-6 w-14" />
          </div>
        ))}
      </div>

      {/* Jump list across the eight queue sections. */}
      <PillRowSkeleton count={8} size="sm" />

      <SectionSkeleton rows={3} />
      <SectionSkeleton rows={2} />
      <SectionSkeleton rows={2} />
    </LoadingShell>
  );
}
