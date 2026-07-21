import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { Eye } from "lucide-react";
import { db } from "@/lib/db/client";
import { leads, quotes, quoteItems } from "@/lib/db/schema";
import { currentActor } from "@/lib/auth";
import { getSettingOr } from "@/lib/domain/settings";
import { MoneyText } from "@/components/shared/money-text";
import { StatusPill } from "@/components/shared/status-pill";

export const metadata: Metadata = { title: "Sales" };

export default async function SalesHomePage() {
  const actor = await currentActor();
  if (!actor) redirect("/staff-login");

  const own = actor.role === "admin" ? undefined : eq(leads.ownerSalesId, actor.userId);
  const pipeline = await db
    .select({
      status: leads.status,
      n: sql<number>`count(*)::int`,
    })
    .from(leads)
    .where(own)
    .groupBy(leads.status);

  const awaiting = await db
    .select()
    .from(quotes)
    .where(
      and(
        actor.role === "admin" ? undefined : eq(quotes.createdBy, actor.userId),
        inArray(quotes.status, ["sent", "viewed"])
      )
    )
    .limit(10);

  // This month: won deals + estimated commission (§9.5), display-only:
  // sum of first-month margin on accepted quotes × commission percent.
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const commissionPercent = await getSettingOr("commission_percent", 10);

  const wonQuotes = await db
    .select()
    .from(quotes)
    .where(
      and(
        actor.role === "admin" ? undefined : eq(quotes.createdBy, actor.userId),
        eq(quotes.status, "accepted"),
        gte(quotes.updatedAt, monthStart)
      )
    );
  let marginCents = 0;
  let marginKnown = true;
  for (const quote of wonQuotes) {
    const items = await db
      .select()
      .from(quoteItems)
      .where(eq(quoteItems.quoteId, quote.id));
    for (const item of items) {
      if (item.itemType === "custom") continue;
      if (item.unitCostCentsSnapshot == null) {
        marginKnown = false;
        continue;
      }
      marginCents +=
        (item.unitPriceCentsSnapshot -
          item.discountCents -
          item.unitCostCentsSnapshot) *
        item.qty;
    }
  }
  const commissionCents = Math.round((marginCents * commissionPercent) / 100);

  const count = (status: string) =>
    pipeline.find((p) => p.status === status)?.n ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My pipeline</h1>
        <p className="text-sm text-muted-foreground">
          Leads, quotes and this month&apos;s wins.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {(["new", "contacted", "quoted", "won", "lost"] as const).map((s) => (
          <Link
            key={s}
            href={`/sales/leads?status=${s}`}
            className="rounded-lg border bg-card p-3 hover:border-primary/40"
          >
            <p className="text-xs capitalize text-muted-foreground">{s}</p>
            <p className="tnum text-2xl font-semibold">{count(s)}</p>
          </Link>
        ))}
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Quotes awaiting response</h2>
        {awaiting.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            Nothing out there right now, build one from a lead.
          </p>
        ) : (
          awaiting.map((quote) => (
            <Link
              key={quote.id}
              href="/sales/quotes"
              className="flex items-center justify-between rounded-lg border bg-card p-3 text-sm hover:border-primary/40"
            >
              <span className="font-mono">{quote.number}</span>
              <span className="flex items-center gap-2">
                {quote.firstViewedAt ? (
                  <span className="flex items-center gap-1 text-xs text-violet-600">
                    <Eye className="size-3" aria-hidden /> viewed
                  </span>
                ) : null}
                <MoneyText cents={quote.totalCents} />
                <StatusPill status={quote.status} />
              </span>
            </Link>
          ))
        )}
      </section>

      <section className="rounded-lg border bg-card p-4">
        <h2 className="text-sm font-semibold">This month</h2>
        <div className="mt-2 grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Won deals</p>
            <p className="tnum text-2xl font-semibold">{wonQuotes.length}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Estimated commission</p>
            <p className="text-2xl font-semibold">
              <MoneyText cents={commissionCents} />
            </p>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Formula: first-month margin on won quotes ({marginKnown ? "" : "excluding lines with missing cost prices, "}
          <MoneyText cents={marginCents} />) × {commissionPercent}%. A
          display-only estimate, payroll confirms the real figure.
        </p>
      </section>
    </div>
  );
}
