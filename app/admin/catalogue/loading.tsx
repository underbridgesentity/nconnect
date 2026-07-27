import { Skeleton } from "@/components/ui/skeleton";
import {
  HeaderSkeleton,
  LoadingShell,
  TableSkeleton,
  TabStripSkeleton,
} from "../skeletons";

/**
 * Catalogue loading state. Plans, hardware, providers, bundles and the
 * per-plan active-service counts all load together, and each hardware row
 * then resolves a signed image URL, so this is never instant.
 */
export default function AdminCatalogueLoading() {
  return (
    <LoadingShell label="the catalogue" className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <HeaderSkeleton />
        <Skeleton className="h-7 w-48 rounded-full" />
      </div>
      <TabStripSkeleton count={4} />
      <div className="flex justify-end">
        <Skeleton className="h-8 w-28 rounded-full" />
      </div>
      <TableSkeleton columns={6} rows={9} />
    </LoadingShell>
  );
}
