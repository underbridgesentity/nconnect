import type { Metadata } from "next";
import Link from "next/link";
import {
  CategoryPlanList,
  fromPriceCents,
  loadCategoryPlans,
  providerNames,
  termLabel,
} from "@/components/public/category-page";
import { PageHeader, type HeaderStat } from "@/components/public/page-header";
import { PillLink } from "@/components/public/pill";
import { MoneyText } from "@/components/shared/money-text";

/*
 * Five minutes, not an hour. Catalogue edits already push instantly through
 * revalidatePath, so this window is purely a safety net, and the case it has to
 * cover is a build that ran while the database was unreachable: those pages
 * prerender an empty catalogue, and an hour of showing a customer no plans at
 * all is far worse than a background regeneration every five minutes.
 */
export const revalidate = 300;

export const metadata: Metadata = {
  title: "Uncapped Fibre",
  description:
    "Uncapped, unshaped fibre on Openserve, Vumatel, Frogfoot and MetroFibre from R533/month. We confirm availability at your address within one business day.",
  alternates: { canonical: "/fibre" },
  openGraph: {
    title: "Uncapped Fibre | Needd Connect",
    description:
      "Uncapped, unshaped fibre on Openserve, Vumatel, Frogfoot and MetroFibre.",
    url: "/fibre",
    type: "website",
  },
};

export default async function FibrePage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; fno?: string }>;
}) {
  const { sort, fno } = await searchParams;
  const plans = await loadCategoryPlans(["fibre"]);
  const from = fromPriceCents(plans);
  const networks = providerNames(plans).length;
  const term = termLabel(plans);

  const stats: HeaderStat[] = [
    ...(from
      ? [
          {
            label: "Fibre from",
            value: (
              <>
                <MoneyText cents={from} whole />
                <span className="text-base font-medium text-white/60">
                  /mo
                </span>
              </>
            ),
          },
        ]
      : []),
    ...(networks > 0
      ? [
          {
            label: "Fibre networks",
            value: <span className="tnum">{networks}</span>,
          },
        ]
      : []),
    ...(term ? [{ label: "Contract", value: term }] : []),
  ];

  return (
    <>
      <PageHeader
        image="/marketing/fibre.webp"
        imageAlt="Glowing fibre optic strands in blue light"
        eyebrow="Fibre"
        title="Fibre that just flows"
        stats={stats}
        actions={
          <>
            <PillLink href="/coverage">Check my address</PillLink>
            <PillLink href="#plans" variant="ink">
              See the plans
            </PillLink>
          </>
        }
      >
        <p>
          Uncapped, unshaped fibre for seamless streaming, gaming and browsing.
          Availability depends on which network reaches your address.{" "}
          <Link href="/coverage">Check your coverage</Link> and we confirm
          within one business day.
        </p>
      </PageHeader>
      <div className="mx-auto max-w-6xl px-4 py-16">
        <CategoryPlanList
          categories={["fibre"]}
          plans={plans}
          basePath="/fibre"
          sort={sort}
          fno={fno}
          groupByProvider
          heading="Uncapped, unshaped fibre plans"
        />
      </div>
    </>
  );
}
