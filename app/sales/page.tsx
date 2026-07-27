import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { Eye, Clock } from "lucide-react";
import { db } from "@/lib/db/client";
import { leads, quotes, orders, orderItems } from "@/lib/db/schema";
import { currentActor } from "@/lib/auth";
import { getSettingOr } from "@/lib/domain/settings";
import { quotesExpiringSoon } from "@/lib/domain/quotes";
import { add, multiply, percentOf } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { MoneyText } from "@/components/shared/money-text";
import { StatusPill } from "@/components/shared/status-pill";

export const metadata: Metadata = { title: "Sales" };

/** South Africa has no daylight saving, so SAST is always UTC+2. */
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;

/** The instant the current Johannesburg calendar month began, in UTC. */
function sastMonthStart(now = new Date()): Date {
  const sast = new Date(now.getTime() + SAST_OFFSET_MS);
  return new Date(
    Date.UTC(sast.getUTCFullYear(), sast.getUTCMonth(), 1) - SAST_OFFSET_MS
  );
}

export default async function SalesHomePage() {
  const actor = await currentActor();
  if (!actor) redirect("/staff-login");

  // The tiles and the page they link to must use one predicate, otherwise a
  // tile says 3 and the list it opens shows 12.
  const scopeParam = actor.role === "admin" ? "all" : "mine";
  const ownLeads =
    actor.role === "admin" ? undefined : eq(leads.ownerSalesId, actor.userId);
  const ownQuotes =
    actor.role === "admin" ? undefined : eq(quotes.createdBy, actor.userId);

  const now = new Date();
  const monthStart = sastMonthStart(now);
  const commissionPercent = await getSettingOr("commission_percent", 10);

  const [pipeline, poolWaiting, awaiting, awaitingTotal, expiringSoon, wonOrders] =
    await Promise.all([
      db
        .select({ status: leads.status, n: sql<number>`count(*)::int` })
        .from(leads)
        .where(ownLeads)
        .groupBy(leads.status),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(leads)
        .where(
          and(isNull(leads.ownerSalesId), inArray(leads.status, ["new", "contacted"]))
        ),
      // Live quotes only: one that lapsed three weeks ago is not work.
      db
        .select()
        .from(quotes)
        .where(
          and(
            ownQuotes,
            inArray(quotes.status, ["sent", "viewed"]),
            or(isNull(quotes.expiresAt), gte(quotes.expiresAt, now))
          )
        )
        .orderBy(desc(quotes.firstViewedAt), desc(quotes.updatedAt))
        .limit(10),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(quotes)
        .where(
          and(
            ownQuotes,
            inArray(quotes.status, ["sent", "viewed"]),
            or(isNull(quotes.expiresAt), gte(quotes.expiresAt, now))
          )
        ),
      quotesExpiringSoon(actor, 3),
      // Won means paid. A quote-derived order only counts once the money has
      // actually landed, so nothing here is revenue we have not received.
      db
        .select({
          id: orders.id,
          number: orders.number,
          totalCents: orders.totalCents,
          paidAt: orders.paidAt,
        })
        .from(orders)
        .where(
          and(
            actor.role === "admin" ? undefined : eq(orders.createdBy, actor.userId),
            isNotNull(orders.quoteId),
            eq(orders.status, "paid"),
            gte(orders.paidAt, monthStart)
          )
        )
        .orderBy(desc(orders.paidAt)),
    ]);

  // One query for every won order's lines, not one per order.
  const wonItems = wonOrders.length
    ? await db
        .select()
        .from(orderItems)
        .where(
          inArray(
            orderItems.orderId,
            wonOrders.map((o) => o.id)
          )
        )
    : [];

  let marginCents = 0;
  let marginKnown = true;
  for (const item of wonItems) {
    if (item.itemType === "custom") continue;
    if (item.unitCostCentsSnapshot == null) {
      marginKnown = false;
      continue;
    }
    marginCents = add(
      marginCents,
      multiply(item.unitPriceCentsSnapshot - item.unitCostCentsSnapshot, item.qty)
    );
  }
  // percentOf, not float division: this is the last money calculation in the
  // sales workspace that went through a JavaScript number. The two also
  // disagree on negative half-cents, so a rep whose margin went negative saw a
  // commission that did not match the same figure computed anywhere else.
  const commissionCents = percentOf(marginCents, commissionPercent);

  const count = (status: string) =>
    pipeline.find((p) => p.status === status)?.n ?? 0;
  const unclaimed = poolWaiting[0]?.n ?? 0;
  const outstanding = awaitingTotal[0]?.n ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My pipeline</h1>
        <p className="text-sm text-muted-foreground">
          Leads, quotes and this month&apos;s wins.
        </p>
      </div>

      {unclaimed > 0 ? (
        <Link
          href="/sales/leads?scope=pool&status=open"
          className="flex items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4 hover:border-primary/60"
        >
          <span>
            <span className="tnum text-lg font-semibold">{unclaimed}</span>{" "}
            <span className="text-sm font-medium">
              unclaimed lead{unclaimed === 1 ? "" : "s"} waiting
            </span>
            <span className="block text-xs text-muted-foreground">
              First rep to claim owns the deal.
            </span>
          </span>
          <span className="touch-target inline-flex shrink-0 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground">
            Open the pool
          </span>
        </Link>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {(["new", "contacted", "quoted", "won", "lost"] as const).map((s) => (
          <Link
            key={s}
            href={`/sales/leads?scope=${scopeParam}&status=${s}`}
            className="rounded-2xl border bg-card p-3 hover:border-primary/40"
          >
            <p className="text-xs capitalize text-muted-foreground">{s}</p>
            <p className="tnum text-2xl font-semibold">{count(s)}</p>
          </Link>
        ))}
      </div>

      {expiringSoon.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Expiring in the next 3 days</h2>
          {expiringSoon.map((quote) => (
            <Link
              key={quote.id}
              href={`/sales/quotes/${quote.id}`}
              className="flex items-center justify-between gap-2 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm hover:border-amber-400"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Clock className="size-4 shrink-0 text-amber-700" aria-hidden />
                <span className="truncate font-mono">{quote.number}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2 text-xs text-amber-800">
                until {formatDate(quote.expiresAt)}
                <MoneyText cents={quote.totalCents} className="text-foreground" />
              </span>
            </Link>
          ))}
        </section>
      ) : null}

      <section className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">Quotes awaiting response</h2>
          {outstanding > awaiting.length ? (
            <Link href="/sales/quotes" className="text-xs text-primary hover:underline">
              See all {outstanding}
            </Link>
          ) : null}
        </div>
        {awaiting.length === 0 ? (
          <p className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
            Nothing out there right now, build one from a lead.
          </p>
        ) : (
          awaiting.map((quote) => (
            <Link
              key={quote.id}
              href={`/sales/quotes/${quote.id}`}
              className="flex items-center justify-between gap-2 rounded-2xl border bg-card p-3 text-sm hover:border-primary/40"
            >
              <span className="font-mono">{quote.number}</span>
              <span className="flex items-center gap-2">
                {quote.firstViewedAt ? (
                  <span className="flex items-center gap-1 text-xs text-violet-700">
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

      <section className="rounded-2xl border bg-card p-4">
        <h2 className="text-sm font-semibold">This month</h2>
        <div className="mt-2 grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Paid deals</p>
            <p className="tnum text-2xl font-semibold">{wonOrders.length}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Estimated commission</p>
            <p className="text-2xl font-semibold">
              <MoneyText cents={commissionCents} />
            </p>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Counts quote-linked orders that have actually been paid this month,
          Johannesburg time. Formula: first-month margin (
          {marginKnown ? "" : "excluding lines with missing cost prices, "}
          <MoneyText cents={marginCents} />) × {commissionPercent}%. A
          display-only estimate, payroll confirms the real figure.
        </p>
      </section>
    </div>
  );
}
