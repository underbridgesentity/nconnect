import type { Metadata } from "next";
import Link from "next/link";
import { Package } from "lucide-react";
import { bundlesWithItems } from "@/lib/domain/catalogue";
import { formatDate } from "@/lib/format";
import { MoneyText } from "@/components/shared/money-text";
import { EmptyState } from "@/components/shared/empty-state";
import { Reveal } from "@/components/shared/reveal";
import { PageHeader, type HeaderStat } from "@/components/public/page-header";
import { PillLink } from "@/components/public/pill";
import { bundleSavingCents } from "@/components/public/bundle-pricing";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Bundle Deals",
  description:
    "Plan-plus-hardware bundles from Needd Connect, one price, everything you need to get online.",
  alternates: { canonical: "/bundles" },
  openGraph: {
    title: "Bundle Deals | Needd Connect",
    description:
      "A plan and the right hardware in one deal, at one price. Everything you need to get online.",
    url: "/bundles",
    type: "website",
  },
};

export default async function BundlesPage() {
  const bundles = await bundlesWithItems({ publishedOnly: true });
  const from =
    bundles.length > 0
      ? Math.min(...bundles.map((b) => b.priceCents))
      : null;

  const stats: HeaderStat[] = [
    ...(bundles.length > 0
      ? [
          {
            label: "Deals running",
            value: <span className="tnum">{bundles.length}</span>,
          },
        ]
      : []),
    ...(from ? [{ label: "From", value: <MoneyText cents={from} whole /> }] : []),
  ];

  return (
    <>
      <PageHeader
        image="/marketing/creators.webp"
        imageAlt="A family using connected devices at home"
        imagePosition="50% 45%"
        eyebrow="Deals"
        title="A plan and the hardware, one price"
        stats={stats}
        actions={
          <>
            <PillLink href="/coverage">Check coverage first</PillLink>
            <PillLink href="/internet" variant="ink">
              Browse all plans
            </PillLink>
          </>
        }
      >
        <p>
          Bundles pair a plan with the router that suits it, so there is
          nothing left to work out at checkout. Every price below is the total
          you pay up front.
        </p>
      </PageHeader>

      <div className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-xl font-semibold tracking-tight">
          Bundles running now
        </h2>
        {bundles.length === 0 ? (
          <div className="mt-8">
            <EmptyState
              icon={Package}
              sentence="No bundle deals are running right now. Browse the plans, every plan page suggests the hardware that fits it."
              action={
                <Link
                  href="/internet"
                  className="text-sm font-medium text-primary hover:underline"
                >
                  Browse plans
                </Link>
              }
            />
          </div>
        ) : (
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {bundles.map((b, index) => {
              const saving = bundleSavingCents(b);
              return (
                <Reveal
                  key={b.id}
                  delay={Math.min(index, 5) * 0.06}
                  className="h-full"
                >
                  <Link
                    href={`/bundles/${b.slug}`}
                    className="card-hover flex h-full flex-col rounded-3xl border bg-card p-6"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-semibold">{b.name}</h3>
                      {saving ? (
                        <span className="shrink-0 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground">
                          Save <MoneyText cents={saving} whole />
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {b.items
                        .map(
                          (i) => i.plan?.name ?? i.hardware?.name ?? i.customName
                        )
                        .filter(Boolean)
                        .join(" + ")}
                    </p>
                    <div className="mt-5 flex flex-1 items-end">
                      <div>
                        <MoneyText
                          cents={b.priceCents}
                          whole
                          className="text-2xl font-semibold"
                        />
                        {b.validUntil ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Valid until {formatDate(b.validUntil)}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </Link>
                </Reveal>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
