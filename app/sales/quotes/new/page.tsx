import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { leads, plans, hardwareProducts, bundles } from "@/lib/db/schema";
import { currentActor } from "@/lib/auth";
import { getSettingOr } from "@/lib/domain/settings";
import { QuoteBuilder } from "../builder";

export const metadata: Metadata = { title: "New quote" };

export default async function NewQuotePage({
  searchParams,
}: {
  searchParams: Promise<{ lead?: string }>;
}) {
  const { lead: leadId } = await searchParams;
  const actor = await currentActor();
  if (!actor) redirect("/staff-login");

  const lead = leadId
    ? (await db.select().from(leads).where(eq(leads.id, leadId)).limit(1))[0]
    : null;

  const [planRows, hardwareRows, bundleRows, floorPercent, noCostMax] =
    await Promise.all([
      db.select().from(plans).where(eq(plans.status, "published")),
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
        <Link
          href="/sales/quotes"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← Quotes
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">New quote</h1>
      </div>
      <QuoteBuilder
        leadId={lead?.id}
        leadName={lead?.name}
        planOptions={planRows.map((p) => ({
          id: p.id,
          name: p.name,
          // Quotes charge first month + once-off, same as checkout.
          priceCents: p.priceCents + p.onceOffCents,
          costCents:
            p.costCents != null ? p.costCents + (p.onceOffCostCents ?? 0) : null,
        }))}
        hardwareOptions={hardwareRows.map((h) => ({
          id: h.id,
          name: h.name,
          priceCents: h.priceCents,
          costCents: h.costCents,
        }))}
        bundleOptions={bundleRows.map((b) => ({
          id: b.id,
          name: b.name,
          priceCents: b.priceCents,
          costCents: null,
        }))}
        floorPercent={floorPercent}
        noCostMaxPercent={noCostMax}
      />
    </div>
  );
}
