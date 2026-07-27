import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Check } from "lucide-react";
import {
  publishedBundleBySlug,
  bundlesWithItems,
} from "@/lib/domain/catalogue";
import { formatCents } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { MoneyText } from "@/components/shared/money-text";
import {
  JsonLd,
  breadcrumbJsonLd,
  offerJsonLd,
} from "@/components/public/json-ld";
import { PageHeader, type HeaderStat } from "@/components/public/page-header";
import { PillLink } from "@/components/public/pill";
import {
  bundleComponentTotalCents,
  bundleSavingCents,
} from "@/components/public/bundle-pricing";
import { appUrl } from "@/lib/config";

export const revalidate = 3600;

export async function generateStaticParams() {
  const bundles = await bundlesWithItems({ publishedOnly: true });
  return bundles.map((b) => ({ slug: b.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const bundle = await publishedBundleBySlug(slug);
  if (!bundle) return { title: "Bundle not found" };
  const title = `${bundle.name}, ${formatCents(bundle.priceCents, {
    whole: true,
  })}`;
  const description = bundle.description ?? bundle.name;
  return {
    title,
    description,
    alternates: { canonical: `/bundles/${bundle.slug}` },
    openGraph: {
      title: `${title} | Needd Connect`,
      description,
      url: `/bundles/${bundle.slug}`,
      type: "website",
    },
  };
}

export default async function BundleDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const bundle = await publishedBundleBySlug(slug);
  if (!bundle) notFound();

  const base = appUrl();
  const separately = bundleComponentTotalCents(bundle);
  const saving = bundleSavingCents(bundle);

  const stats: HeaderStat[] = [
    { label: "Bundle price", value: <MoneyText cents={bundle.priceCents} whole /> },
    ...(saving
      ? [{ label: "You save", value: <MoneyText cents={saving} whole /> }]
      : []),
    ...(bundle.validUntil
      ? [{ label: "Valid until", value: formatDate(bundle.validUntil) }]
      : []),
  ];

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Product",
          name: bundle.name,
          description: bundle.description ?? undefined,
          url: `${base}/bundles/${bundle.slug}`,
          offers: offerJsonLd({
            appUrl: base,
            path: `/bundles/${bundle.slug}`,
            priceCents: bundle.priceCents,
            ...(bundle.validUntil ? { priceValidUntil: bundle.validUntil } : {}),
          }),
        }}
      />
      <JsonLd
        data={breadcrumbJsonLd(base, [
          { name: "Home", path: "/" },
          { name: "Bundles", path: "/bundles" },
          { name: bundle.name, path: `/bundles/${bundle.slug}` },
        ])}
      />

      <PageHeader
        image="/marketing/creators.webp"
        imageAlt=""
        imagePosition="50% 45%"
        size="compact"
        eyebrow="Bundle deal"
        title={bundle.name}
        breadcrumb={[
          { label: "Home", href: "/" },
          { label: "Bundles", href: "/bundles" },
          { label: bundle.name },
        ]}
        stats={stats}
        actions={
          <>
            <PillLink href={`/signup?bundle=${bundle.slug}`}>
              Grab this deal
            </PillLink>
            <PillLink href="/coverage" variant="ink">
              Check coverage first
            </PillLink>
          </>
        }
      >
        {bundle.description ? <p>{bundle.description}</p> : null}
      </PageHeader>

      <div className="mx-auto max-w-3xl px-4 py-14">
        <section className="rounded-3xl border bg-card p-6 sm:p-8">
          <h2 className="text-lg font-semibold tracking-tight">
            What&apos;s in the bundle
          </h2>
          <ul className="mt-5 divide-y">
            {bundle.items.map((item) => {
              const unit =
                item.plan?.priceCents ??
                item.hardware?.priceCents ??
                item.customPriceCents;
              const suffix = item.plan ? "/month on its own" : "once-off on its own";
              return (
                <li
                  key={item.id}
                  className="flex items-start justify-between gap-4 py-3 first:pt-0"
                >
                  <span className="flex items-start gap-2.5 text-sm leading-6">
                    <Check
                      className="mt-1 size-4 shrink-0 text-primary"
                      aria-hidden
                    />
                    <span>
                      {item.qty > 1 ? `${item.qty} x ` : ""}
                      {item.plan?.name ?? item.hardware?.name ?? item.customName}
                    </span>
                  </span>
                  {unit !== null && unit !== undefined ? (
                    <span className="shrink-0 whitespace-nowrap text-sm text-muted-foreground">
                      <MoneyText cents={unit} whole /> {suffix}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>

          <div className="mt-6 border-t pt-6">
            {separately !== null ? (
              <div className="flex items-baseline justify-between gap-4 text-sm text-muted-foreground">
                <span>Bought separately</span>
                <span>
                  <MoneyText cents={separately} whole />
                </span>
              </div>
            ) : null}
            <div className="mt-2 flex items-baseline justify-between gap-4">
              <span className="font-semibold">Bundle price</span>
              <MoneyText
                cents={bundle.priceCents}
                whole
                className="text-3xl font-semibold"
              />
            </div>
            {saving ? (
              <p className="mt-3 inline-flex rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground">
                You save <MoneyText cents={saving} whole className="ml-1" />
              </p>
            ) : null}
            <p className="mt-4 text-xs leading-5 text-muted-foreground">
              That is your first payment: the first month of the plan plus any
              once-off hardware. Monthly billing then starts on your activation
              date.
              {bundle.validUntil
                ? ` Offer valid until ${formatDate(bundle.validUntil)}.`
                : ""}
            </p>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <PillLink href={`/signup?bundle=${bundle.slug}`}>
              Grab this deal
            </PillLink>
            <PillLink href="/bundles" variant="outline">
              See other deals
            </PillLink>
          </div>
        </section>
      </div>
    </>
  );
}
