import type { Metadata } from "next";
import Link from "next/link";
import { CategoryPlanList } from "@/components/public/category-page";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "SIM Data Deals",
  description:
    "Telkom capped LTE data on 24-month terms from R232/month — SIM only, data split between day and night bundles. Routers sold separately.",
  alternates: { canonical: "/sim-data" },
};

export default async function SimDataPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const { sort } = await searchParams;
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">SIM Data</h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">
        Flexible, affordable mobile data on 24-month subscriptions. SIM-only —
        pair with any LTE router or MiFi from our{" "}
        <Link href="/hardware" className="text-primary hover:underline">
          hardware range
        </Link>
        . Data splits equally between day and night bundles.
      </p>
      <div className="mt-8">
        <CategoryPlanList
          categories={["sim_data"]}
          basePath="/sim-data"
          sort={sort}
        />
      </div>
    </div>
  );
}
