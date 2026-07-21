import type { Metadata } from "next";
import Link from "next/link";
import { CategoryPlanList } from "@/components/public/category-page";
import { PageHeader } from "@/components/public/page-header";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "SIM Data Deals",
  description:
    "Telkom capped LTE data on 24-month terms from R232/month. SIM only, data split between day and night bundles. Routers sold separately.",
  alternates: { canonical: "/sim-data" },
};

export default async function SimDataPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const { sort } = await searchParams;
  return (
    <>
      <PageHeader
        image="/marketing/sim.webp"
        imageAlt="A hand holding a SIM card next to a smartphone"
        title="SIM data, straight up"
      >
        <p>
          Flexible, affordable mobile data on 24-month subscriptions. SIM
          only: pair with any LTE router or MiFi from our{" "}
          <Link href="/hardware">hardware range</Link>. Data splits equally
          between day and night bundles.
        </p>
      </PageHeader>
      <div className="mx-auto max-w-6xl px-4 py-12">
        <CategoryPlanList
          categories={["sim_data"]}
          basePath="/sim-data"
          sort={sort}
        />
      </div>
    </>
  );
}
