import type { Metadata } from "next";
import Link from "next/link";
import { CategoryPlanList } from "@/components/public/category-page";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Uncapped Fibre",
  description:
    "Uncapped, unshaped fibre on Openserve, Vumatel, Frogfoot and MetroFibre from R533/month. We confirm availability at your address within one business day.",
  alternates: { canonical: "/fibre" },
};

export default async function FibrePage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; fno?: string }>;
}) {
  const { sort, fno } = await searchParams;
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Fibre</h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">
        Uncapped, unshaped fibre for seamless streaming, gaming and browsing.
        Availability depends on which network reaches your address —{" "}
        <Link href="/coverage" className="text-primary hover:underline">
          check your coverage
        </Link>{" "}
        and we&apos;ll confirm within one business day.
      </p>
      <div className="mt-8">
        <CategoryPlanList
          categories={["fibre"]}
          basePath="/fibre"
          sort={sort}
          fno={fno}
          groupByProvider
        />
      </div>
    </div>
  );
}
