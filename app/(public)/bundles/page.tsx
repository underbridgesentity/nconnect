import type { Metadata } from "next";
import Link from "next/link";
import { Package } from "lucide-react";
import { bundlesWithItems } from "@/lib/domain/catalogue";
import { MoneyText } from "@/components/shared/money-text";
import { EmptyState } from "@/components/shared/empty-state";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Bundle Deals",
  description:
    "Plan-plus-hardware bundles from Needd Connect — one price, everything you need to get online.",
  alternates: { canonical: "/bundles" },
};

export default async function BundlesPage() {
  const bundles = await bundlesWithItems({ publishedOnly: true });

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Bundles</h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">
        A plan and the right hardware in one deal, at one price.
      </p>
      {bundles.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon={Package}
            sentence="No bundle deals are running right now. Browse the plans — every plan page suggests the hardware that fits it."
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
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {bundles.map((b) => (
            <Link
              key={b.id}
              href={`/bundles/${b.slug}`}
              className="rounded-lg border bg-card p-5 transition-shadow hover:shadow-sm"
            >
              <h2 className="font-semibold">{b.name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {b.items
                  .map((i) => i.plan?.name ?? i.hardware?.name ?? i.customName)
                  .filter(Boolean)
                  .join(" + ")}
              </p>
              <p className="mt-3">
                <MoneyText
                  cents={b.priceCents}
                  whole
                  className="text-2xl font-semibold"
                />
              </p>
              {b.validUntil ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Valid until {b.validUntil}
                </p>
              ) : null}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
