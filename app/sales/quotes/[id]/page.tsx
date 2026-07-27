import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { CalendarClock, Copy, Repeat } from "lucide-react";
import { db } from "@/lib/db/client";
import { auditLog, orders } from "@/lib/db/schema";
import { currentActor } from "@/lib/auth";
import { quoteDetail, type OrderStatus } from "@/lib/domain/quotes";
import { formatDate, formatDateTime } from "@/lib/format";
import { StatusPill } from "@/components/shared/status-pill";
import { MoneyText } from "@/components/shared/money-text";
import { BackLink } from "../../back-link";
import { SendQuoteButton, CopyLinkButton } from "../client";

export const metadata: Metadata = { title: "Quote" };

const ACTION_LABEL: Record<string, string> = {
  "quote.create": "Built",
  "quote.send": "Sent to the customer",
  "quote.send_failed": "Delivery failed",
  "quote.order_created": "Customer accepted, order raised",
  "quote.accept": "Paid, quote won",
  "quote.expire": "Expired",
};

type OrderRow = {
  id: string;
  number: string;
  status: OrderStatus;
  paidAt: Date | null;
};

/**
 * What the order behind the quote actually means, with every status of the
 * enum spelled out. `mid_checkout` is the one this screen used to lose: a
 * customer sitting at PayFast has accepted the quote, so nothing about it has
 * lapsed even if the validity date rolled over while they were on the payment
 * page. The nightly `expireQuotes` sweep already leaves those alone, and this
 * is the screen agreeing with it instead of calling the quote dead.
 */
type QuoteOrderView =
  | { kind: "mid_checkout"; number: string }
  | { kind: "settled"; number: string; line: string }
  | { kind: "cancelled"; number: string };

function describeQuoteOrder(order: OrderRow): QuoteOrderView {
  switch (order.status) {
    case "pending_payment":
      return { kind: "mid_checkout", number: order.number };
    case "paid":
      return {
        kind: "settled",
        number: order.number,
        line: order.paidAt ? `Paid ${formatDate(order.paidAt)}.` : "Paid.",
      };
    case "processing":
      return {
        kind: "settled",
        number: order.number,
        line: "Paid, and being prepared now.",
      };
    case "fulfilled":
      return {
        kind: "settled",
        number: order.number,
        line: "Paid and fulfilled.",
      };
    case "cancelled":
      return { kind: "cancelled", number: order.number };
  }
}

export default async function QuoteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await currentActor();
  if (!actor) redirect("/staff-login");

  const detail = await quoteDetail(actor, id);
  if (!detail) notFound();
  const { quote, items, breakdown, lead, customer, link, expired, expiresInDays } =
    detail;

  const [order] = quote.acceptedOrderId
    ? await db
        .select({
          id: orders.id,
          number: orders.number,
          status: orders.status,
          paidAt: orders.paidAt,
        })
        .from(orders)
        .where(eq(orders.id, quote.acceptedOrderId))
        .limit(1)
    : [];

  const trail = await db
    .select({
      action: auditLog.action,
      createdAt: auditLog.createdAt,
      after: auditLog.after,
    })
    .from(auditLog)
    .where(and(eq(auditLog.entity, "quote"), eq(auditLog.entityId, quote.id)))
    .orderBy(asc(auditLog.createdAt));

  const view = order ? describeQuoteOrder(order) : null;
  const midCheckout = view?.kind === "mid_checkout";

  // Expiry is a date, acceptance is an event, and the date must not overrule
  // the event. A quote the customer has taken to PayFast is in checkout, not
  // lapsed, whatever the calendar says.
  const lapsed = expired && !midCheckout && quote.status !== "accepted";
  const effectiveStatus = midCheckout
    ? "pending_payment"
    : lapsed
      ? "expired"
      : quote.status;
  const contactName =
    lead?.name ??
    customer?.companyName ??
    [customer?.firstName, customer?.lastName].filter(Boolean).join(" ") ??
    null;

  return (
    <div className="space-y-6">
      <div>
        <BackLink href="/sales/quotes">Quotes</BackLink>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-mono text-2xl font-semibold tracking-tight">
              {quote.number}
            </h1>
            <p className="text-sm text-muted-foreground">
              {lead ? (
                <Link href={`/sales/leads/${lead.id}`} className="hover:text-primary">
                  {lead.name}
                </Link>
              ) : (
                (contactName ?? "No contact linked")
              )}
              {quote.createdAt ? ` · built ${formatDate(quote.createdAt)}` : ""}
            </p>
          </div>
          <StatusPill status={effectiveStatus} />
        </div>
      </div>

      {/*
        Deadline talk only while the deadline is still the story. Once an order
        exists the banner below says what is actually happening, and stacking
        "lapsed" on top of it would be two notices arguing about one quote.
      */}
      {order ? null : lapsed ? (
        <p className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          This quote lapsed on {formatDate(quote.expiresAt)}. The customer can no
          longer accept it. Duplicate it to send a fresh one at current prices.
        </p>
      ) : expiresInDays != null &&
        expiresInDays <= 3 &&
        quote.status !== "accepted" ? (
        <p className="flex items-center gap-2 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <CalendarClock className="size-4 shrink-0" aria-hidden />
          Expires {formatDate(quote.expiresAt)}. Worth a call today.
        </p>
      ) : null}

      {view ? (
        view.kind === "mid_checkout" ? (
          <p className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            The customer accepted this quote and order {view.number} is waiting
            on their payment. Their quote link takes them straight back to it,
            and the price is held while they finish, so there is nothing to
            resend
            {expired && quote.expiresAt
              ? ` even though the validity date passed on ${formatDate(quote.expiresAt)}`
              : ""}
            . A nudge on WhatsApp is the useful move.
          </p>
        ) : view.kind === "settled" ? (
          <p className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            Accepted and paid: order {view.number}. {view.line}
          </p>
        ) : (
          <p className="rounded-2xl border bg-muted/40 p-4 text-sm text-muted-foreground">
            Order {view.number} was raised from this quote and then cancelled,
            so nothing was charged. The quote stays reserved against it and
            cannot be sent again. Duplicate it to quote current prices.
          </p>
        )
      ) : null}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Lines</h2>
        <div className="overflow-hidden rounded-2xl border bg-card">
          {items.map((item) => {
            const line = breakdown.lines.find((l) => l.id === item.id);
            const margin =
              item.unitCostCentsSnapshot != null
                ? (item.unitPriceCentsSnapshot -
                    item.discountCents -
                    item.unitCostCentsSnapshot) *
                  item.qty
                : null;
            return (
              <div
                key={item.id}
                className="flex flex-wrap items-start justify-between gap-3 border-b p-3 text-sm last:border-0"
              >
                <span className="min-w-0">
                  <span className="block font-medium">
                    {item.nameSnapshot}
                    {item.qty > 1 ? ` × ${item.qty}` : ""}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {item.discountCents > 0 ? (
                      <>
                        includes <MoneyText cents={item.discountCents} /> off.{" "}
                      </>
                    ) : null}
                    {line?.monthlyCents != null ? (
                      <>
                        <MoneyText cents={line.monthlyCents} /> of this recurs
                        monthly.
                      </>
                    ) : (
                      "Once-off."
                    )}
                  </span>
                </span>
                <span className="text-right">
                  <MoneyText cents={line?.payNowCents ?? 0} className="font-medium" />
                  <span
                    className={`tnum block text-xs ${margin != null && margin < 0 ? "text-destructive" : "text-muted-foreground"}`}
                  >
                    {margin != null ? (
                      <>
                        margin <MoneyText cents={margin} />
                      </>
                    ) : (
                      "cost not set"
                    )}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-2xl border bg-muted/40 p-3 text-sm">
            <p className="text-xs text-muted-foreground">Due on acceptance</p>
            <p className="text-lg font-semibold">
              <MoneyText cents={breakdown.payNowCents} />
            </p>
          </div>
          <div className="rounded-2xl border bg-muted/40 p-3 text-sm">
            <p className="text-xs text-muted-foreground">Then per month</p>
            <p className="text-lg font-semibold">
              {breakdown.hasRecurring ? (
                <MoneyText cents={breakdown.monthlyCents} />
              ) : (
                <span className="text-base font-normal text-muted-foreground">
                  Nothing recurring
                </span>
              )}
            </p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Your margin on this quote:{" "}
          {detail.marginKnown ? (
            <MoneyText cents={detail.marginCents} />
          ) : (
            <>
              at least <MoneyText cents={detail.marginCents} />, some lines have no
              cost price
            </>
          )}
          . Never shown to the customer.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Share link</h2>
        <p className="rounded-2xl border bg-muted/40 p-3 font-mono text-xs break-all">
          {link}
        </p>
        <div className="flex flex-wrap gap-2">
          <CopyLinkButton link={link} />
          {/*
            No order and still in date. `sendQuote` refuses outright once an
            order is reserved against the quote, whatever state that order is
            in, so a Resend button there is a button that only ever returns an
            error. Duplicate is the real next step and it is right beside this.
          */}
          {!expired && !order && quote.status !== "accepted" ? (
            <SendQuoteButton
              quoteId={quote.id}
              variant="outline"
              label={quote.status === "draft" ? "Send" : "Resend"}
            />
          ) : null}
          <Link
            href={`/sales/quotes/new?from=${quote.id}${lead ? `&lead=${lead.id}` : ""}`}
            className="touch-target inline-flex items-center gap-1.5 rounded-full border px-5 text-sm font-medium hover:bg-accent"
          >
            <Repeat className="size-4" aria-hidden /> Duplicate as new quote
          </Link>
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className="touch-target inline-flex items-center gap-1.5 rounded-full border px-5 text-sm font-medium hover:bg-accent"
          >
            <Copy className="size-4" aria-hidden /> See what the customer sees
          </a>
        </div>
        <p className="text-xs text-muted-foreground">
          Opening the link yourself marks the quote as viewed, which is worth
          knowing before you use it to check the wording.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Timeline</h2>
        <div className="space-y-2">
          {trail.map((entry, i) => (
            <div
              key={`${entry.action}-${i}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border bg-card p-3 text-sm"
            >
              <span className="font-medium">
                {ACTION_LABEL[entry.action] ?? entry.action}
                {entry.action === "quote.send" && Array.isArray(entry.after?.channels) ? (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    by {(entry.after.channels as string[]).join(", ")}
                  </span>
                ) : null}
              </span>
              <span className="tnum text-xs text-muted-foreground">
                {formatDateTime(entry.createdAt)}
              </span>
            </div>
          ))}
          {quote.firstViewedAt ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-violet-200 bg-violet-50 p-3 text-sm">
              <span className="font-medium text-violet-900">
                First opened by the customer
              </span>
              <span className="tnum text-xs text-violet-800">
                {formatDateTime(quote.firstViewedAt)}
              </span>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
