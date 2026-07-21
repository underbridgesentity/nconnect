import type { Metadata } from "next";
import Link from "next/link";
import { CategoryPlanList } from "@/components/public/category-page";
import { PageHeader } from "@/components/public/page-header";

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
    <>
      <PageHeader
        image="/marketing/fibre.webp"
        imageAlt="Glowing fibre optic strands in blue light"
        title="Fibre that just flows"
      >
        <p>
          Uncapped, unshaped fibre for seamless streaming, gaming and
          browsing. Availability depends on which network reaches your
          address. <Link href="/coverage">Check your coverage</Link> and we
          confirm within one business day.
        </p>
      </PageHeader>
      <div className="mx-auto max-w-6xl px-4 py-12">
        <CategoryPlanList
          categories={["fibre"]}
          basePath="/fibre"
          sort={sort}
          fno={fno}
          groupByProvider
        />
      </div>
    </>
  );
}
