import type { Metadata } from "next";
import Link from "next/link";
import { CategoryPlanList } from "@/components/public/category-page";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Uncapped LTE & 5G Home Internet",
  description:
    "Uncapped MTN, Vodacom and Telkom LTE/5G home internet from R331/month. No fixed line needed — plug in the router and you're online.",
  alternates: { canonical: "/internet" },
};

export default async function InternetPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const { sort } = await searchParams;
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">
        Home Internet — Uncapped LTE & 5G
      </h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">
        High-speed wireless internet with no fixed line required. Perfect for
        homes, remote work and streaming. Router must be network-approved —
        see{" "}
        <Link href="/hardware" className="text-primary hover:underline">
          hardware
        </Link>
        .
      </p>
      <div className="mt-8">
        <CategoryPlanList
          categories={["lte_home", "telkom_lte"]}
          basePath="/internet"
          sort={sort}
        />
      </div>
      <p className="mt-8 text-xs text-muted-foreground">
        5G coverage is subject to area; devices fall back to 4G LTE-Advanced in
        limited coverage zones. Allow up to 24 hours after SIM insertion for
        data allocation.
      </p>
    </div>
  );
}
