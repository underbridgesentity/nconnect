import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  leads,
  plans,
  providers,
  hardwareProducts,
  bundles,
} from "@/lib/db/schema";
import { currentActor } from "@/lib/auth";
import { getSettingOr } from "@/lib/domain/settings";
import { quoteDetail } from "@/lib/domain/quotes";
import { BackLink } from "../../back-link";
import { QuoteBuilder } from "../builder";
import type { QuoteDraftItem } from "../actions";

export const metadata: Metadata = { title: "New quote" };

export default async function NewQuotePage({
  searchParams,
}: {
  searchParams: Promise<{ lead?: string; from?: string }>;
}) {
  const { lead: leadId, from } = await searchParams;
  const actor = await currentActor();
  if (!actor) redirect("/staff-login");

  const lead = leadId
    ? (await db.select().from(leads).where(eq(leads.id, leadId)).limit(1))[0]
    : null;

  // Duplicating an existing quote: seed the builder with its lines so a typo
  // or a revision does not mean rebuilding from zero. Prices re-resolve from
  // the catalogue on save, so the copy is never stale.
  const source = from ? await quoteDetail(actor, from) : null;
  const initialItems: QuoteDraftItem[] | undefined = source
    ? source.items.map((i) => ({
        itemType: i.itemType,
        planId: i.planId ?? undefined,
        hardwareId: i.hardwareId ?? undefined,
        bundleId: i.bundleId ?? undefined,
        customName: i.itemType === "custom" ? i.nameSnapshot : undefined,
        customPriceRands:
          i.itemType === "custom" ? i.unitPriceCentsSnapshot / 100 : undefined,
        discountRands: i.discountCents ? i.discountCents / 100 : undefined,
        qty: i.qty,
      }))
    : undefined;

  const [planRows, hardwareRows, bundleRows, floorPercent, noCostMax] =
    await Promise.all([
      db
        .select({ plan: plans, providerName: providers.name })
        .from(plans)
        .leftJoin(providers, eq(providers.id, plans.providerId))
        .where(eq(plans.status, "published")),
      db
        .select()
        .from(hardwareProducts)
        .where(eq(hardwareProducts.status, "published")),
      db.select().from(bundles).where(eq(bundles.status, "published")),
      getSettingOr("min_margin_floor_percent", 10),
      getSettingOr("no_cost_max_discount_percent", 15),
    ]);

  return (
    <div className="space-y-4">
      <div>
        <BackLink href="/sales/quotes">Quotes</BackLink>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {source ? `Quote based on ${source.quote.number}` : "New quote"}
        </h1>
        {source ? (
          <p className="text-sm text-muted-foreground">
            Lines copied across. Saving creates a new Q number, the original
            stays exactly as the customer saw it.
          </p>
        ) : null}
      </div>
      <QuoteBuilder
        leadId={lead?.id ?? source?.lead?.id}
        leadName={lead?.name ?? source?.lead?.name}
        initialItems={initialItems}
        draftScope={from ?? undefined}
        planOptions={planRows.map(({ plan: p, providerName }) => ({
          id: p.id,
          name: p.name,
          detail: [
            providerName,
            p.speedDownMbps ? `${p.speedDownMbps} Mbps` : null,
            p.dataAllocation,
          ]
            .filter(Boolean)
            .join(" · "),
          // Quotes charge first month + once-off, same as checkout.
          priceCents: p.priceCents + p.onceOffCents,
          costCents:
            p.costCents != null ? p.costCents + (p.onceOffCostCents ?? 0) : null,
        }))}
        hardwareOptions={hardwareRows.map((h) => ({
          id: h.id,
          name: h.name,
          detail: h.sku,
          priceCents: h.priceCents,
          costCents: h.costCents,
        }))}
        bundleOptions={bundleRows.map((b) => ({
          id: b.id,
          name: b.name,
          detail: null,
          priceCents: b.priceCents,
          costCents: null,
        }))}
        floorPercent={floorPercent}
        noCostMaxPercent={noCostMax}
      />
    </div>
  );
}
