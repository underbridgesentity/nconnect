import type { Metadata } from "next";
import {
  CategoryPlanList,
  fromPriceCents,
  loadCategoryPlans,
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
  title: "Business VoIP",
  description:
    "Cloud phone systems from R382/month: up to 20 extensions, call recording, IVR, per-second billing and number porting. Calls from R0.26/min.",
  alternates: { canonical: "/voip" },
  openGraph: {
    title: "Business VoIP | Needd Connect",
    description:
      "Cloud phone systems with call recording, IVR, per-second billing and number porting.",
    url: "/voip",
    type: "website",
  },
};

export default async function VoipPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const { sort } = await searchParams;
  const plans = await loadCategoryPlans(["voip"]);
  const from = fromPriceCents(plans);
  const term = termLabel(plans);

  const stats: HeaderStat[] = [
    ...(from
      ? [
          {
            label: "Systems from",
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
    { label: "Telkom landline calls", value: <span className="tnum">R0.26/min</span> },
    ...(term ? [{ label: "Contract", value: term }] : []),
  ];

  return (
    <>
      <PageHeader
        image="/marketing/voip.webp"
        imageAlt="A business owner taking a call at her desk"
        imagePosition="50% 35%"
        eyebrow="Business VoIP"
        title="Business VoIP that sounds like you mean it"
        stats={stats}
        actions={
          <>
            <PillLink href="#plans">See the plans</PillLink>
            <PillLink href="/contact" variant="ink">
              Talk to us about porting
            </PillLink>
          </>
        }
      >
        <p>
          Crystal-clear calls without the cost of a traditional landline. Keep
          your existing number, get call recording and IVR, and pay per second:
          local mobile R0.69/min, Telkom landlines R0.26/min, international
          (USA/UK) R0.27/min.
        </p>
      </PageHeader>
      <div className="mx-auto max-w-6xl px-4 py-16">
        <CategoryPlanList
          categories={["voip"]}
          plans={plans}
          basePath="/voip"
          sort={sort}
          heading="Cloud phone systems"
        />
        <p className="mt-12 max-w-2xl text-xs leading-5 text-muted-foreground">
          3-month call time rollover. Number porting supported. Upgrades
          available at any time.
        </p>
      </div>
    </>
  );
}
