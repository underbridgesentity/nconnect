import type { Metadata } from "next";
import Link from "next/link";
import { FileDown, AlertCircle, Star } from "lucide-react";
import {
  allPlansWithProviders,
  allHardware,
  allProviders,
  bundlesWithItems,
} from "@/lib/domain/catalogue";
import { fileUrl } from "@/lib/storage";
import { StatusPill } from "@/components/shared/status-pill";
import { MoneyText } from "@/components/shared/money-text";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  PlanEditor,
  HardwareEditor,
  StatusMenu,
  NewPlanButton,
  NewHardwareButton,
  type PlanRow,
  type HardwareRow,
} from "./editors";
import { PLAN_CATEGORIES, HW_CATEGORIES } from "./constants";
import { BundleBuilder, type BundleDraft } from "./bundle-builder";

export const metadata: Metadata = { title: "Catalogue" };

function Margin({ price, cost }: { price: number; cost: number | null }) {
  if (cost == null) {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-amber-300 bg-amber-50 text-amber-700"
      >
        <AlertCircle className="size-3" /> cost missing
      </Badge>
    );
  }
  const margin = price - cost;
  return (
    <MoneyText
      cents={margin}
      className={cn("text-sm", margin < 0 && "text-destructive")}
    />
  );
}

export default async function CataloguePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab = "plans" } = await searchParams;
  const [plans, hardware, providers, bundles] = await Promise.all([
    allPlansWithProviders(),
    allHardware(),
    allProviders(),
    bundlesWithItems({ publishedOnly: false }),
  ]);

  const providerOptions = providers.map((p) => ({ id: p.id, name: p.name }));
  const hardwareWithUrls: HardwareRow[] = await Promise.all(
    hardware.map(async (h) => ({
      id: h.id,
      sku: h.sku,
      name: h.name,
      category: h.category,
      description: h.description,
      priceCents: h.priceCents,
      costCents: h.costCents,
      stockQty: h.stockQty,
      lowStockThreshold: h.lowStockThreshold,
      status: h.status,
      imagePath: h.imagePath,
      imageUrl: h.imagePath ? await fileUrl("catalogue", h.imagePath) : null,
      sortOrder: h.sortOrder,
    }))
  );

  const planRows: PlanRow[] = plans.map((p) => ({
    id: p.id,
    providerId: p.providerId,
    category: p.category,
    name: p.name,
    slug: p.slug,
    description: p.description,
    speedDownMbps: p.speedDownMbps,
    speedUpMbps: p.speedUpMbps,
    dataAllocation: p.dataAllocation,
    fupDetail: p.fupDetail,
    contractMonths: p.contractMonths,
    priceCents: p.priceCents,
    costCents: p.costCents,
    onceOffCents: p.onceOffCents,
    onceOffCostCents: p.onceOffCostCents,
    status: p.status,
    featured: p.featured,
    sortOrder: p.sortOrder,
    providerName: p.provider.name,
  }));

  const planOptions = plans
    .filter((p) => p.status === "published")
    .map((p) => ({
      id: p.id,
      name: p.name,
      priceCents: p.priceCents,
      costCents: p.costCents,
    }));
  const hardwareOptions = hardware
    .filter((h) => h.status === "published")
    .map((h) => ({
      id: h.id,
      name: h.name,
      priceCents: h.priceCents,
      costCents: h.costCents,
    }));

  const TABS = [
    { key: "plans", label: `Plans (${plans.length})` },
    { key: "hardware", label: `Hardware (${hardware.length})` },
    { key: "bundles", label: `Bundles (${bundles.length})` },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Catalogue</h1>
          <p className="text-sm text-muted-foreground">
            One catalogue, one truth, the site, signup, quotes and the PDF all
            render from these records.
          </p>
        </div>
        <a
          href="/admin/catalogue/pdf"
          download
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <FileDown className="size-4" /> Generate PDF catalogue
        </a>
      </div>

      <div className="flex gap-1 border-b">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/admin/catalogue?tab=${t.key}`}
            className={cn(
              "touch-target flex items-center border-b-2 px-3 text-sm font-medium",
              tab === t.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "plans" ? (
        <div className="space-y-8">
          <div className="flex justify-end">
            <NewPlanButton providers={providerOptions} />
          </div>
          {PLAN_CATEGORIES.map((cat) => {
            const rows = planRows.filter((p) => p.category === cat.value);
            if (rows.length === 0) return null;
            return (
              <section key={cat.value}>
                <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
                  {cat.label}
                </h2>
                <div className="overflow-x-auto rounded-lg border bg-card">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="p-3 font-medium">Plan</th>
                        <th className="p-3 font-medium">Provider</th>
                        <th className="p-3 text-right font-medium">Sell</th>
                        <th className="p-3 text-right font-medium">Cost</th>
                        <th className="p-3 text-right font-medium">Margin</th>
                        <th className="p-3 font-medium">Status</th>
                        <th className="p-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((p) => (
                        <tr key={p.id} className="border-b last:border-0">
                          <td className="p-3">
                            <span className="flex items-center gap-1.5 font-medium">
                              {p.name}
                              {p.featured ? (
                                <Star
                                  className="size-3.5 fill-amber-400 text-amber-400"
                                  aria-label="Featured"
                                />
                              ) : null}
                            </span>
                          </td>
                          <td className="p-3 text-muted-foreground">
                            {p.providerName}
                          </td>
                          <td className="p-3 text-right">
                            <MoneyText cents={p.priceCents} whole />
                          </td>
                          <td className="p-3 text-right">
                            {p.costCents != null ? (
                              <MoneyText cents={p.costCents} whole />
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                          <td className="p-3 text-right">
                            <Margin price={p.priceCents} cost={p.costCents} />
                          </td>
                          <td className="p-3">
                            <StatusPill status={p.status} />
                          </td>
                          <td className="p-3">
                            <div className="flex items-center justify-end gap-0.5">
                              <PlanEditor plan={p} providers={providerOptions} />
                              <StatusMenu kind="plan" id={p.id} status={p.status} />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      ) : null}

      {tab === "hardware" ? (
        <div className="space-y-8">
          <div className="flex justify-end">
            <NewHardwareButton />
          </div>
          {HW_CATEGORIES.map((cat) => {
            const rows = hardwareWithUrls.filter((h) => h.category === cat.value);
            if (rows.length === 0) return null;
            return (
              <section key={cat.value}>
                <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
                  {cat.label}
                </h2>
                <div className="overflow-x-auto rounded-lg border bg-card">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="p-3 font-medium">Product</th>
                        <th className="p-3 font-medium">SKU</th>
                        <th className="p-3 text-right font-medium">Price</th>
                        <th className="p-3 text-right font-medium">Cost</th>
                        <th className="p-3 text-right font-medium">Margin</th>
                        <th className="p-3 text-right font-medium">Stock</th>
                        <th className="p-3 font-medium">Status</th>
                        <th className="p-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((h) => (
                        <tr key={h.id} className="border-b last:border-0">
                          <td className="p-3">
                            <span className="flex items-center gap-2 font-medium">
                              {h.imageUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element -- signed/dev URLs
                                <img
                                  src={h.imageUrl}
                                  alt=""
                                  className="h-8 w-8 rounded border object-contain"
                                />
                              ) : (
                                <span className="flex h-8 w-8 items-center justify-center rounded border bg-muted text-[10px] text-muted-foreground">
                                  no img
                                </span>
                              )}
                              {h.name}
                            </span>
                          </td>
                          <td className="p-3 font-mono text-xs text-muted-foreground">
                            {h.sku}
                          </td>
                          <td className="p-3 text-right">
                            <MoneyText cents={h.priceCents} whole />
                          </td>
                          <td className="p-3 text-right">
                            {h.costCents != null ? (
                              <MoneyText cents={h.costCents} whole />
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                          <td className="p-3 text-right">
                            <Margin price={h.priceCents} cost={h.costCents} />
                          </td>
                          <td className="p-3 text-right">
                            <span
                              className={cn(
                                "tnum",
                                h.stockQty <= h.lowStockThreshold &&
                                  "font-medium text-amber-700"
                              )}
                            >
                              {h.stockQty}
                            </span>
                          </td>
                          <td className="p-3">
                            <StatusPill status={h.status} />
                          </td>
                          <td className="p-3">
                            <div className="flex items-center justify-end gap-0.5">
                              <HardwareEditor hardware={h} />
                              <StatusMenu
                                kind="hardware"
                                id={h.id}
                                status={h.status}
                              />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      ) : null}

      {tab === "bundles" ? (
        <div className="space-y-4">
          <div className="flex justify-end">
            <BundleBuilder
              planOptions={planOptions}
              hardwareOptions={hardwareOptions}
            />
          </div>
          {bundles.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No bundles yet. Compose plans, hardware and custom lines into a
              deal with the builder.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {bundles.map((b) => {
                const draft: BundleDraft = {
                  id: b.id,
                  name: b.name,
                  slug: b.slug,
                  description: b.description ?? "",
                  priceRands: b.priceCents / 100,
                  featured: b.featured,
                  validUntil: b.validUntil ?? undefined,
                  items: b.items.map((i) => ({
                    itemType: i.itemType,
                    planId: i.planId ?? undefined,
                    hardwareId: i.hardwareId ?? undefined,
                    customName: i.customName ?? undefined,
                    customPriceRands:
                      i.customPriceCents != null
                        ? i.customPriceCents / 100
                        : undefined,
                    qty: i.qty,
                  })),
                };
                return (
                  <div key={b.id} className="rounded-lg border bg-card p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-medium">{b.name}</h3>
                        <p className="text-sm text-muted-foreground">
                          {b.items
                            .map(
                              (i) =>
                                i.plan?.name ?? i.hardware?.name ?? i.customName
                            )
                            .filter(Boolean)
                            .join(" + ")}
                        </p>
                      </div>
                      <StatusPill status={b.status} />
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <MoneyText cents={b.priceCents} whole className="text-lg" />
                      <div className="flex items-center gap-0.5">
                        <BundleBuilder
                          planOptions={planOptions}
                          hardwareOptions={hardwareOptions}
                          existing={draft}
                        />
                        <StatusMenu kind="bundle" id={b.id} status={b.status} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
