import type { Metadata } from "next";
import Link from "next/link";
import { publishedHardware } from "@/lib/domain/catalogue";
import { fileUrl } from "@/lib/storage";
import { EmptyState } from "@/components/shared/empty-state";
import { MoneyText } from "@/components/shared/money-text";
import { Reveal } from "@/components/shared/reveal";
import { PageHeader, type HeaderStat } from "@/components/public/page-header";
import { PillLink } from "@/components/public/pill";
import { ProductImage } from "@/components/public/product-image";
import { cn } from "@/lib/utils";

/*
 * Five minutes, not an hour. Catalogue edits already push instantly through
 * revalidatePath, so this window is purely a safety net, and the case it has to
 * cover is a build that ran while the database was unreachable: those pages
 * prerender an empty catalogue, and an hour of showing a customer no plans at
 * all is far worse than a background regeneration every five minutes.
 */
export const revalidate = 300;

export const metadata: Metadata = {
  title: "Routers & Hardware",
  description:
    "Network-approved LTE, 5G and fibre routers, mesh Wi-Fi, extenders, VoIP phones and back-up power, from R144.",
  alternates: { canonical: "/hardware" },
  openGraph: {
    title: "Routers & Hardware | Needd Connect",
    description:
      "Network-approved LTE, 5G and fibre routers, mesh Wi-Fi, extenders, VoIP phones and back-up power.",
    url: "/hardware",
    type: "website",
  },
};

const CATEGORY_LABELS: [string, string][] = [
  ["router_lte", "LTE routers"],
  ["router_5g", "5G routers"],
  ["router_fibre", "Fibre routers"],
  ["mesh", "Mesh Wi-Fi"],
  ["extender", "Extenders"],
  ["voip_phone", "VoIP phones"],
  ["power", "Back-up power"],
  ["accessory", "Accessories"],
];

export default async function HardwarePage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category } = await searchParams;
  const all = await publishedHardware();
  const items = category ? all.filter((h) => h.category === category) : all;
  const urls = await Promise.all(
    items.map((h) =>
      h.imagePath ? fileUrl("catalogue", h.imagePath) : Promise.resolve(null)
    )
  );

  const presentCategories = CATEGORY_LABELS.filter(([key]) =>
    all.some((h) => h.category === key)
  );
  const activeLabel = presentCategories.find(([key]) => key === category)?.[1];
  const from =
    all.length > 0 ? Math.min(...all.map((h) => h.priceCents)) : null;

  const stats: HeaderStat[] = [
    ...(from
      ? [{ label: "Devices from", value: <MoneyText cents={from} whole /> }]
      : []),
    ...(all.length > 0
      ? [
          {
            label: "In the range",
            value: <span className="tnum">{all.length}</span>,
          },
        ]
      : []),
    ...(presentCategories.length > 0
      ? [
          {
            label: "Categories",
            value: <span className="tnum">{presentCategories.length}</span>,
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        image="/marketing/creators.webp"
        imageAlt="A family using connected devices at home"
        imagePosition="50% 40%"
        eyebrow="Hardware"
        title="Hardware that earns its shelf space"
        stats={stats}
        actions={
          <>
            <PillLink href="/internet">Browse plans</PillLink>
            <PillLink href="/contact" variant="ink">
              Ask about a device
            </PillLink>
          </>
        }
      >
        <p>
          Approved routers and accessories, added to your plan at signup or
          quoted by our team. Hardware attaches to an order; pricing here is
          for reference.
        </p>
      </PageHeader>

      <div className="mx-auto max-w-6xl px-4 py-16">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">
              {activeLabel ?? "The full range"}
            </h2>
            {items.length > 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {items.length} {items.length === 1 ? "device" : "devices"},
                once-off pricing.
              </p>
            ) : null}
          </div>
          <nav
            className="flex flex-wrap gap-2 text-sm"
            aria-label="Hardware categories"
          >
            <Link
              href="/hardware"
              aria-current={!category ? "true" : undefined}
              className={cn(
                "inline-flex min-h-9 items-center rounded-full px-4",
                !category
                  ? "bg-primary font-medium text-primary-foreground"
                  : "border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              )}
            >
              All
            </Link>
            {presentCategories.map(([key, label]) => (
              <Link
                key={key}
                href={`/hardware?category=${key}`}
                aria-current={category === key ? "true" : undefined}
                className={cn(
                  "inline-flex min-h-9 items-center rounded-full px-4",
                  category === key
                    ? "bg-primary font-medium text-primary-foreground"
                    : "border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                )}
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>

        {items.length === 0 ? (
          // Two different truths: one category is bare, or the whole range is.
          // The old copy said "in this category" either way, which read as a
          // filter problem to somebody looking at an empty shop.
          <EmptyState
            className="mt-8 bg-card/50"
            title={
              category
                ? "Nothing published in this category right now"
                : "No hardware published right now"
            }
            description={
              category
                ? "The rest of the range is still listed."
                : "We are between stock listings. Ask us and we will tell you what we can get."
            }
            action={
              category ? (
                <PillLink href="/hardware" variant="outline" size="sm">
                  See the full range
                </PillLink>
              ) : (
                <PillLink href="/contact" variant="outline" size="sm">
                  Ask us directly
                </PillLink>
              )
            }
          />
        ) : (
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {items.map((h, i) => (
              <Reveal
                key={h.id}
                delay={Math.min(i, 7) * 0.04}
                className="h-full"
              >
                <Link
                  href={`/hardware/${h.sku}`}
                  className="card-hover img-zoom group flex h-full flex-col rounded-3xl border bg-card p-4"
                >
                  <ProductImage src={urls[i]} alt={h.name} />
                  <h3 className="mt-4 text-sm font-semibold">{h.name}</h3>
                  {h.description ? (
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                      {h.description}
                    </p>
                  ) : null}
                  <p className="mt-3 flex flex-1 items-end">
                    <MoneyText
                      cents={h.priceCents}
                      whole
                      className="text-lg font-semibold"
                    />
                  </p>
                </Link>
              </Reveal>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
