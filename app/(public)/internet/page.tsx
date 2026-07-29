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
  title: "Uncapped LTE & 5G Home Internet",
  description:
    "Uncapped MTN, Vodacom and Telkom LTE/5G home internet from R331/month. No fixed line needed. Plug in the router and you're online.",
  alternates: { canonical: "/internet" },
  openGraph: {
    title: "Uncapped LTE & 5G Home Internet | Needd Connect",
    description:
      "Uncapped MTN, Vodacom and Telkom LTE/5G home internet. No fixed line needed.",
    url: "/internet",
    type: "website",
  },
};

export default async function InternetPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const { sort } = await searchParams;
  const plans = await loadCategoryPlans(["lte_home", "telkom_lte"]);
  const from = fromPriceCents(plans);
  const networks = providerNames(plans).length;
  const term = termLabel(plans);

  const stats: HeaderStat[] = [
    ...(from
      ? [
          {
            label: "Plans from",
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
      ? [{ label: "Networks", value: <span className="tnum">{networks}</span> }]
      : []),
    ...(term ? [{ label: "Contract", value: term }] : []),
  ];

  return (
    <>
      <PageHeader
        image="/marketing/internet.webp"
        imageAlt="A couple at home on the sofa using fast wireless internet"
        imagePosition="50% 40%"
        eyebrow="Home Internet"
        title="Uncapped LTE and 5G, no fixed line"
        stats={stats}
        actions={
          <>
            <PillLink href="/coverage">Check coverage at my address</PillLink>
            <PillLink href="#plans" variant="ink">
              See the plans
            </PillLink>
          </>
        }
      >
        <p>
          High-speed wireless internet with no fixed line required. Perfect for
          homes, remote work and streaming. Router must be network-approved,
          see <Link href="/hardware">hardware</Link>.
        </p>
      </PageHeader>
      <div className="mx-auto max-w-6xl px-4 py-16">
        <CategoryPlanList
          categories={["lte_home", "telkom_lte"]}
          plans={plans}
          basePath="/internet"
          sort={sort}
          heading="Uncapped LTE and 5G home plans"
        />
        <p className="mt-12 max-w-2xl text-xs leading-5 text-muted-foreground">
          5G coverage is subject to area; devices fall back to 4G LTE-Advanced
          in limited coverage zones. Allow up to 24 hours after SIM insertion
          for data allocation.
        </p>
      </div>
    </>
  );
}
