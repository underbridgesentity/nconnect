import { Skeleton } from "@/components/ui/skeleton";
import {
  HeaderSkeleton,
  LoadingShell,
  SearchSkeleton,
  TableSkeleton,
} from "../skeletons";

/**
 * Customers list loading state. The search runs across invoice numbers, SIMs,
 * MSISDNs and provider references, which is four correlated subqueries, so on
 * a real book this is the slowest list in the workspace.
 */
export default function AdminCustomersLoading() {
  return (
    <LoadingShell label="customers" className="mx-auto max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <HeaderSkeleton />
        <Skeleton className="h-9 w-32 rounded-md" />
      </div>
      <SearchSkeleton />
      <TableSkeleton columns={5} rows={10} />
    </LoadingShell>
  );
}
