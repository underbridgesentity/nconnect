import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { inArray } from "drizzle-orm";
import { FileText, Plus, Eye } from "lucide-react";
import { db } from "@/lib/db/client";
import { orders } from "@/lib/db/schema";
import { currentActor } from "@/lib/auth";
import { listQuotes, quoteShareLink } from "@/lib/domain/quotes";
import { formatDate, formatDateTime } from "@/lib/format";
import { StatusPill } from "@/components/shared/status-pill";
import { MoneyText } from "@/components/shared/money-text";
import { EmptyState } from "@/components/shared/empty-state";
import { SendQuoteButton, CopyLinkButton } from "./client";

export const metadata: Metadata = { title: "Quotes" };

export default async function SalesQuotesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const actor = await currentActor();
  if (!actor) redirect("/staff-login");

  const search = q?.trim() ?? "";
  const rows = await listQuotes(actor, { search });

  // One query for every accepted quote's order number, not one per quote.
  const acceptedOrderIds = rows.flatMap((r) =>
    r.quote.acceptedOrderId ? [r.quote.acceptedOrderId] : []
  );
  const orderRows = acceptedOrderIds.length
    ? await db
        .select({ id: orders.id, number: orders.number, status: orders.status })
        .from(orders)
        .where(inArray(orders.id, acceptedOrderIds))
    : [];
  const orderById = new Map(orderRows.map((o) => [o.id, o]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Quotes</h1>
          <p className="text-sm text-muted-foreground">
            Draft, sent, viewed, accepted, with the paper trail intact.
          </p>
        </div>
        <Link
          href="/sales/quotes/new"
          className="inline-flex touch-target items-center gap-1.5 rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 hover:bg-[#0f5a91]"
        >
          <Plus className="size-4" /> New quote
        </Link>
      </div>

      <form action="/sales/quotes" className="flex flex-wrap gap-2">
        <input
          type="search"
          name="q"
          defaultValue={search}
          placeholder="Quote number or customer name"
          aria-label="Search quotes"
          className="h-11 min-w-48 flex-1 rounded-full border bg-background px-4 text-sm"
        />
        <button
          type="submit"
          className="touch-target rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-[#0f5a91]"
        >
          Search
        </button>
        {search ? (
          <Link
            href="/sales/quotes"
            className="touch-target inline-flex items-center rounded-full border px-5 text-sm font-medium hover:bg-accent"
          >
            Clear
          </Link>
        ) : null}
      </form>

      {rows.length === 0 ? (
        <EmptyState
          icon={FileText}
          sentence={
            search
              ? `No quote matches "${search}". Try the Q number on its own.`
              : "No quotes yet. Build one from a lead, it sends as a WhatsApp, email or SMS link and you'll see the moment it's opened."
          }
        />
      ) : (
        <div className="space-y-2">
          {rows.map(({ quote, effectiveStatus, expiresInDays, leadName }) => {
            const order = quote.acceptedOrderId
              ? orderById.get(quote.acceptedOrderId)
              : null;
            const expired = effectiveStatus === "expired";
            const expiringSoon =
              !expired &&
              expiresInDays != null &&
              expiresInDays <= 3 &&
              ["sent", "viewed"].includes(effectiveStatus);
            return (
              <div
                key={quote.id}
                className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-4 ${
                  expiringSoon ? "border-amber-300" : ""
                } ${expired ? "opacity-70" : ""}`}
              >
                <Link href={`/sales/quotes/${quote.id}`} className="min-w-0 flex-1">
                  <p className="font-mono text-sm font-medium hover:text-primary">
                    {quote.number}
                    {leadName ? (
                      <span className="ml-2 font-sans text-sm text-muted-foreground">
                        {leadName}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {quote.expiresAt
                      ? expired
                        ? `Expired ${formatDate(quote.expiresAt)}`
                        : expiringSoon
                          ? `Expires ${formatDate(quote.expiresAt)}, chase it today`
                          : `Valid until ${formatDate(quote.expiresAt)}`
                      : ""}
                    {quote.firstViewedAt ? (
                      <span className="ml-2 inline-flex items-center gap-1 text-violet-700">
                        <Eye className="size-3" aria-hidden />
                        viewed {formatDateTime(quote.firstViewedAt)}
                      </span>
                    ) : null}
                  </p>
                  {order ? (
                    <p className="text-xs text-emerald-700">
                      Accepted, order {order.number}
                      {order.status === "pending_payment"
                        ? " (payment not completed yet)"
                        : ""}
                    </p>
                  ) : null}
                </Link>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <MoneyText cents={quote.totalCents} />
                  <StatusPill status={effectiveStatus} />
                  {effectiveStatus === "draft" ? (
                    <SendQuoteButton quoteId={quote.id} />
                  ) : null}
                  {!expired && effectiveStatus !== "accepted" ? (
                    <CopyLinkButton link={quoteShareLink(quote.shareToken)} />
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
