import type { Metadata } from "next";
import Link from "next/link";
import {
  CategoryPlanList,
  fromPriceCents,
  loadCategoryPlans,
  termLabel,
} from "@/components/public/category-page";
import { PageHeader, type HeaderStat } from "@/components/public/page-header";
import { PillLink } from "@/components/public/pill";
import { MoneyText } from "@/components/shared/money-text";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "SIM Data Deals",
  description:
    "Telkom capped LTE data on 24-month terms from R232/month. SIM only, data split between day and night bundles. Routers sold separately.",
  alternates: { canonical: "/sim-data" },
  openGraph: {
    title: "SIM Data Deals | Needd Connect",
    description:
      "Capped LTE data on 24-month terms. SIM only, pair it with any LTE router.",
    url: "/sim-data",
    type: "website",
  },
};

export default async function SimDataPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const { sort } = await searchParams;
  const plans = await loadCategoryPlans(["sim_data"]);
  const from = fromPriceCents(plans);
  const term = termLabel(plans);

  const stats: HeaderStat[] = [
    ...(from
      ? [
          {
            label: "Data from",
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
    ...(term ? [{ label: "Contract", value: term }] : []),
    { label: "Hardware", value: "SIM only" },
  ];

  return (
    <>
      <PageHeader
        image="/marketing/sim.webp"
        imageAlt="A hand holding a SIM card next to a smartphone"
        imagePosition="50% 45%"
        eyebrow="SIM Data"
        title="SIM data, straight up"
        stats={stats}
        actions={
          <>
            <PillLink href="#plans">See the deals</PillLink>
            <PillLink href="/hardware" variant="ink">
              Browse routers
            </PillLink>
          </>
        }
      >
        <p>
          Flexible, affordable mobile data on 24-month subscriptions. SIM only:
          pair with any LTE router or MiFi from our{" "}
          <Link href="/hardware">hardware range</Link>. Data splits equally
          between day and night bundles.
        </p>
      </PageHeader>
      <div className="mx-auto max-w-6xl px-4 py-16">
        <CategoryPlanList
          categories={["sim_data"]}
          plans={plans}
          basePath="/sim-data"
          sort={sort}
          heading="Capped LTE data deals"
        />
      </div>
    </>
  );
}
