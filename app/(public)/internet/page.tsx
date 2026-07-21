import type { Metadata } from "next";
import Link from "next/link";
import { CategoryPlanList } from "@/components/public/category-page";
import { PageHeader } from "@/components/public/page-header";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Uncapped LTE & 5G Home Internet",
  description:
    "Uncapped MTN, Vodacom and Telkom LTE/5G home internet from R331/month. No fixed line needed. Plug in the router and you're online.",
  alternates: { canonical: "/internet" },
};

export default async function InternetPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const { sort } = await searchParams;
  return (
    <>
      <PageHeader
        image="/marketing/internet.webp"
        imageAlt="A couple at home on the sofa using fast wireless internet"
        title="Home Internet, uncapped LTE and 5G"
      >
        <p>
          High-speed wireless internet with no fixed line required. Perfect
          for homes, remote work and streaming. Router must be
          network-approved, see <Link href="/hardware">hardware</Link>.
        </p>
      </PageHeader>
      <div className="mx-auto max-w-6xl px-4 py-12">
        <CategoryPlanList
          categories={["lte_home", "telkom_lte"]}
          basePath="/internet"
          sort={sort}
        />
        <p className="mt-10 text-xs text-muted-foreground">
          5G coverage is subject to area; devices fall back to 4G
          LTE-Advanced in limited coverage zones. Allow up to 24 hours after
          SIM insertion for data allocation.
        </p>
      </div>
    </>
  );
}
