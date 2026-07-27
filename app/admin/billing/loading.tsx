import {
  HeaderSkeleton,
  LoadingShell,
  PillRowSkeleton,
  SearchSkeleton,
  TableSkeleton,
  TabStripSkeleton,
} from "../skeletons";

/**
 * Billing loading state. Every tab here aggregates payments per invoice
 * before it can show a single row, so the header and the tab strip appearing
 * first is the difference between "it is working" and "nothing happened".
 */
export default function AdminBillingLoading() {
  return (
    <LoadingShell label="billing" className="mx-auto max-w-5xl">
      <HeaderSkeleton />
      <TabStripSkeleton count={4} />
      <SearchSkeleton />
      <PillRowSkeleton count={6} />
      <TableSkeleton columns={7} rows={10} />
    </LoadingShell>
  );
}
