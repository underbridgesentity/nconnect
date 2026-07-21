import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { FileText, Plus, Eye } from "lucide-react";
import { db } from "@/lib/db/client";
import { orders } from "@/lib/db/schema";
import { currentActor } from "@/lib/auth";
import { listQuotes } from "@/lib/domain/quotes";
import { StatusPill } from "@/components/shared/status-pill";
import { MoneyText } from "@/components/shared/money-text";
import { EmptyState } from "@/components/shared/empty-state";
import { SendQuoteButton } from "./client";

export const metadata: Metadata = { title: "Quotes" };

export default async function SalesQuotesPage() {
  const actor = await currentActor();
  if (!actor) redirect("/staff-login");

  const rows = await listQuotes(actor);
  const acceptedOrderIds = rows.flatMap((q) =>
    q.acceptedOrderId ? [q.acceptedOrderId] : []
  );
  const orderNumbers = new Map<string, string>();
  for (const orderId of acceptedOrderIds) {
    const [order] = await db
      .select({ number: orders.number })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    if (order) orderNumbers.set(orderId, order.number);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Quotes</h1>
          <p className="text-sm text-muted-foreground">
            Draft → sent → viewed → accepted, with the paper trail intact.
          </p>
        </div>
        <Link
          href="/sales/quotes/new"
          className="flex touch-target items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="size-4" /> New quote
        </Link>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={FileText}
          sentence="No quotes yet. Build one from a lead, it sends as a WhatsApp/email link and you'll see the moment it's opened."
        />
      ) : (
        <div className="space-y-2">
          {rows.map((quote) => (
            <div
              key={quote.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card p-4"
            >
              <div>
                <p className="font-mono text-sm font-medium">{quote.number}</p>
                <p className="text-xs text-muted-foreground">
                  {quote.expiresAt
                    ? `Valid until ${quote.expiresAt.toISOString().slice(0, 10)}`
                    : ""}
                  {quote.firstViewedAt ? (
                    <span className="ml-2 inline-flex items-center gap-1 text-violet-600">
                      <Eye className="size-3" aria-hidden />
                      viewed{" "}
                      {quote.firstViewedAt.toISOString().replace("T", " ").slice(0, 16)}
                    </span>
                  ) : null}
                </p>
                {quote.acceptedOrderId ? (
                  <p className="text-xs text-emerald-700">
                    Accepted → order {orderNumbers.get(quote.acceptedOrderId)}
                  </p>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <MoneyText cents={quote.totalCents} />
                <StatusPill status={quote.status} />
                {quote.status === "draft" ? (
                  <SendQuoteButton quoteId={quote.id} />
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
