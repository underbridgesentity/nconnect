import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  publishedHardware,
  publishedHardwareBySku,
} from "@/lib/domain/catalogue";
import { fileUrl } from "@/lib/storage";
import { formatCents } from "@/lib/money";
import { MoneyText } from "@/components/shared/money-text";
import {
  JsonLd,
  breadcrumbJsonLd,
  offerJsonLd,
} from "@/components/public/json-ld";
import { PageHeader } from "@/components/public/page-header";
import { PillLink } from "@/components/public/pill";
import { ProductImage } from "@/components/public/product-image";
import { appUrl } from "@/lib/config";

export const revalidate = 3600;

/**
 * Prerender the catalogue when the database is reachable, and degrade to
 * on-demand rendering when it is not.
 *
 * A build-time query that throws fails the whole deployment, so a database
 * outage would block an unrelated hotfix from shipping. dynamicParams defaults
 * to true, so returning an empty list still serves every product correctly, just
 * rendered on request instead of at build.
 */
export async function generateStaticParams() {
  try {
    const items = await publishedHardware();
    return items.map((h) => ({ sku: h.sku }));
  } catch (err) {
    console.error("hardware: could not prerender, falling back to on-demand:", err);
    return [];
  }
}

/**
 * Catalogue images live in a public bucket in production, but fall back to an
 * expiring local URL in development. Only an absolute, non-expiring URL is
 * safe to hand to a scraper or to schema.org.
 */
function shareableImage(url: string | null): string | null {
  return url && url.startsWith("http") ? url : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ sku: string }>;
}): Promise<Metadata> {
  const { sku } = await params;
  const item = await publishedHardwareBySku(sku);
  if (!item) return { title: "Hardware not found" };
  const image = shareableImage(
    item.imagePath ? await fileUrl("catalogue", item.imagePath) : null
  );
  const price = formatCents(item.priceCents, { whole: true });
  return {
    title: `${item.name}, ${price}`,
    description: item.description ?? item.name,
    alternates: { canonical: `/hardware/${item.sku}` },
    openGraph: {
      title: `${item.name}, ${price}`,
      description: item.description ?? item.name,
      url: `/hardware/${item.sku}`,
      type: "website",
      ...(image ? { images: [image] } : {}),
    },
  };
}

export default async function HardwareDetailPage({
  params,
}: {
  params: Promise<{ sku: string }>;
}) {
  const { sku } = await params;
  const item = await publishedHardwareBySku(sku);
  if (!item) notFound();

  const base = appUrl();
  const imageUrl = item.imagePath
    ? await fileUrl("catalogue", item.imagePath)
    : null;
  const schemaImage = shareableImage(imageUrl);

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Product",
          name: item.name,
          sku: item.sku,
          description: item.description ?? undefined,
          url: `${base}/hardware/${item.sku}`,
          ...(schemaImage ? { image: [schemaImage] } : {}),
          offers: offerJsonLd({
            appUrl: base,
            path: `/hardware/${item.sku}`,
            priceCents: item.priceCents,
            inStock: item.stockQty > 0,
          }),
        }}
      />
      <JsonLd
        data={breadcrumbJsonLd(base, [
          { name: "Home", path: "/" },
          { name: "Hardware", path: "/hardware" },
          { name: item.name, path: `/hardware/${item.sku}` },
        ])}
      />

      <PageHeader
        size="compact"
        eyebrow={<span className="font-mono normal-case">{item.sku}</span>}
        title={item.name}
        breadcrumb={[
          { label: "Home", href: "/" },
          { label: "Hardware", href: "/hardware" },
          { label: item.name },
        ]}
        stats={[
          {
            label: "Once-off",
            value: <MoneyText cents={item.priceCents} whole />,
          },
        ]}
      />

      <div className="mx-auto max-w-5xl px-4 py-14">
        <div className="grid gap-10 md:grid-cols-2">
          <ProductImage
            src={imageUrl}
            alt={item.name}
            ratio="1/1"
            className="border bg-card p-8"
          />
          <div>
            <h2 className="text-lg font-semibold tracking-tight">
              About this device
            </h2>
            {item.description ? (
              <p className="mt-3 text-base leading-7 text-foreground/85">
                {item.description}
              </p>
            ) : (
              <p className="mt-3 text-base leading-7 text-muted-foreground">
                Full specifications for this device are on request. Ask us and
                we will send them through.
              </p>
            )}
            <div className="mt-6 rounded-2xl border bg-accent/40 p-5 text-sm leading-6 text-foreground/80">
              Hardware is added to your order during signup, or quoted with a
              plan by our team, there is no standalone checkout. Pick your plan
              first and we will suggest the right device.
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <PillLink href="/internet">Browse plans</PillLink>
              <PillLink href="/contact" variant="outline">
                Ask about this device
              </PillLink>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
