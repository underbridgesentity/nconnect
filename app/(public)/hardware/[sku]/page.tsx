import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  publishedHardware,
  publishedHardwareBySku,
} from "@/lib/domain/catalogue";
import { fileUrl } from "@/lib/storage";
import { MoneyText } from "@/components/shared/money-text";
import { JsonLd } from "@/components/public/json-ld";

export const revalidate = 3600;

export async function generateStaticParams() {
  const items = await publishedHardware();
  return items.map((h) => ({ sku: h.sku }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ sku: string }>;
}): Promise<Metadata> {
  const { sku } = await params;
  const item = await publishedHardwareBySku(sku);
  if (!item) return { title: "Hardware not found" };
  return {
    title: `${item.name}, R${Math.round(item.priceCents / 100)}`,
    description: item.description ?? item.name,
    alternates: { canonical: `/hardware/${item.sku}` },
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

  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const imageUrl = item.imagePath
    ? await fileUrl("catalogue", item.imagePath)
    : null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Product",
          name: item.name,
          sku: item.sku,
          description: item.description ?? undefined,
          url: `${appUrl}/hardware/${item.sku}`,
          offers: {
            "@type": "Offer",
            price: (item.priceCents / 100).toFixed(2),
            priceCurrency: "ZAR",
            availability:
              item.stockQty > 0
                ? "https://schema.org/InStock"
                : "https://schema.org/PreOrder",
          },
        }}
      />
      <nav className="text-sm text-muted-foreground" aria-label="Breadcrumb">
        <Link href="/" className="hover:text-foreground">
          Home
        </Link>{" "}
        /{" "}
        <Link href="/hardware" className="hover:text-foreground">
          Hardware
        </Link>{" "}
        / {item.name}
      </nav>

      <div className="mt-6 grid gap-8 md:grid-cols-2">
        <div className="flex items-center justify-center rounded-lg border bg-card p-8">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- storage URLs
            <img
              src={imageUrl}
              alt={item.name}
              className="max-h-64 object-contain"
            />
          ) : (
            <p className="text-sm text-muted-foreground">Image coming soon</p>
          )}
        </div>
        <div>
          <p className="font-mono text-xs text-muted-foreground">{item.sku}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{item.name}</h1>
          <p className="mt-3">
            <MoneyText
              cents={item.priceCents}
              whole
              className="text-3xl font-semibold"
            />
          </p>
          {item.description ? (
            <p className="mt-3 text-muted-foreground">{item.description}</p>
          ) : null}
          <div className="mt-6 rounded-lg border bg-card p-4 text-sm text-muted-foreground">
            Hardware is added to your order during signup, or quoted with a
            plan by our team, there&apos;s no standalone checkout. Pick your
            plan first and we&apos;ll suggest the right device.
          </div>
          <div className="mt-4 flex gap-3">
            <Link
              href="/internet"
              className="flex touch-target items-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Browse plans
            </Link>
            <Link
              href="/contact"
              className="flex touch-target items-center rounded-md border px-5 text-sm font-medium hover:bg-accent"
            >
              Ask about this device
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
