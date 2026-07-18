import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check } from "lucide-react";
import {
  publishedBundleBySlug,
  bundlesWithItems,
} from "@/lib/domain/catalogue";
import { MoneyText } from "@/components/shared/money-text";

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
  return {
    title: `${bundle.name} — R${Math.round(bundle.priceCents / 100)}`,
    description: bundle.description ?? bundle.name,
    alternates: { canonical: `/bundles/${bundle.slug}` },
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

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <nav className="text-sm text-muted-foreground" aria-label="Breadcrumb">
        <Link href="/" className="hover:text-foreground">
          Home
        </Link>{" "}
        /{" "}
        <Link href="/bundles" className="hover:text-foreground">
          Bundles
        </Link>{" "}
        / {bundle.name}
      </nav>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">
        {bundle.name}
      </h1>
      {bundle.description ? (
        <p className="mt-2 text-muted-foreground">{bundle.description}</p>
      ) : null}

      <div className="mt-6 rounded-lg border bg-card p-6">
        <h2 className="text-sm font-semibold text-muted-foreground">
          What&apos;s in the bundle
        </h2>
        <ul className="mt-3 space-y-2">
          {bundle.items.map((item) => (
            <li key={item.id} className="flex items-center gap-2 text-sm">
              <Check className="size-4 text-primary" aria-hidden />
              {item.qty > 1 ? `${item.qty}× ` : ""}
              {item.plan?.name ?? item.hardware?.name ?? item.customName}
              {item.plan ? (
                <span className="text-muted-foreground">
                  (<MoneyText cents={item.plan.priceCents} whole />
                  /month on its own)
                </span>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="mt-4 border-t pt-4">
          <MoneyText
            cents={bundle.priceCents}
            whole
            className="text-3xl font-semibold"
          />
          {bundle.validUntil ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Offer valid until {bundle.validUntil}
            </p>
          ) : null}
        </div>
        <Link
          href={`/signup?bundle=${bundle.slug}`}
          className="mt-4 flex touch-target items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Grab this deal
        </Link>
      </div>
    </div>
  );
}
