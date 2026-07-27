import { Skeleton } from "@/components/ui/skeleton";
import { LoadingShell, TableSkeleton, TabStripSkeleton } from "../skeletons";

/**
 * Reports and Settings loading state, used on the first paint of the route.
 * Once the shell is mounted, switching tabs is handled by the per-tab Suspense
 * boundaries in `page.tsx`, so only the tab body waits and the heading and tab
 * strip stay on screen.
 */
export default function AdminReportsLoading() {
  return (
    <LoadingShell label="reports and settings" className="mx-auto max-w-5xl">
      <Skeleton className="h-7 w-56 max-w-full" />
      <TabStripSkeleton count={7} />
      <div className="space-y-8">
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-56 max-w-full" />
            <Skeleton className="h-3 w-10 shrink-0" />
          </div>
          <TableSkeleton columns={3} rows={5} />
        </section>
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-64 max-w-full" />
            <Skeleton className="h-3 w-10 shrink-0" />
          </div>
          <TableSkeleton columns={4} rows={4} />
        </section>
      </div>
    </LoadingShell>
  );
}
