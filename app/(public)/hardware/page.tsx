import type { Metadata } from "next";
import Link from "next/link";
import { publishedHardware } from "@/lib/domain/catalogue";
import { fileUrl } from "@/lib/storage";
import { MoneyText } from "@/components/shared/money-text";
import { cn } from "@/lib/utils";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Routers & Hardware",
  description:
    "Network-approved LTE, 5G and fibre routers, mesh Wi-Fi, extenders, VoIP phones and back-up power — from R144.",
  alternates: { canonical: "/hardware" },
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

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Hardware</h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">
        Approved routers and accessories, added to your plan at signup or
        quoted by our team. Hardware attaches to an order — pricing here is for
        reference.
      </p>

      <nav
        className="mt-6 flex flex-wrap gap-2 text-sm"
        aria-label="Hardware categories"
      >
        <Link
          href="/hardware"
          className={cn(
            "rounded-full px-3 py-1",
            !category
              ? "bg-primary font-medium text-primary-foreground"
              : "border text-muted-foreground hover:bg-accent"
          )}
        >
          All
        </Link>
        {presentCategories.map(([key, label]) => (
          <Link
            key={key}
            href={`/hardware?category=${key}`}
            className={cn(
              "rounded-full px-3 py-1",
              category === key
                ? "bg-primary font-medium text-primary-foreground"
                : "border text-muted-foreground hover:bg-accent"
            )}
          >
            {label}
          </Link>
        ))}
      </nav>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((h, i) => (
          <Link
            key={h.id}
            href={`/hardware/${h.sku}`}
            className="rounded-lg border bg-card p-4 transition-shadow hover:shadow-sm"
          >
            {urls[i] ? (
              // eslint-disable-next-line @next/next/no-img-element -- storage URLs
              <img
                src={urls[i]!}
                alt={h.name}
                className="mb-3 h-32 w-full rounded object-contain"
              />
            ) : (
              <div className="mb-3 flex h-32 w-full items-center justify-center rounded bg-muted text-xs text-muted-foreground">
                Image coming soon
              </div>
            )}
            <h2 className="text-sm font-medium">{h.name}</h2>
            {h.description ? (
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                {h.description}
              </p>
            ) : null}
            <p className="mt-2">
              <MoneyText cents={h.priceCents} whole className="font-semibold" />
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
