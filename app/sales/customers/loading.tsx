import {
  CardListSkeleton,
  HeaderSkeleton,
  LoadingShell,
  SearchRowSkeleton,
} from "../skeletons";

/** My customers loading state: header, the pill search row, then the cards. */
export default function SalesCustomersLoading() {
  return (
    <LoadingShell label="your customers">
      <HeaderSkeleton />
      <SearchRowSkeleton />
      <CardListSkeleton rows={6} />
    </LoadingShell>
  );
}
