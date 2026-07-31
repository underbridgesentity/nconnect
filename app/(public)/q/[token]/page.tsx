import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { Check, Mail, MessageCircle, RefreshCw, XCircle } from "lucide-react";
import { db } from "@/lib/db/client";
import { orders } from "@/lib/db/schema";
import { quoteDocument, type OrderStatus } from "@/lib/domain/quotes";
import { formatCents } from "@/lib/money";
import { formatDateLong } from "@/lib/format";
import { MoneyText } from "@/components/shared/money-text";
import {
  whatsappHref,
  whatsappHrefFor,
} from "@/components/public/whatsapp";
import { PillLink } from "@/components/public/pill";
import { ResumePaymentButton } from "./resume";

export const metadata: Metadata = {
  title: "Your quote",
  robots: { index: false, follow: false },
};

type OrderRow = { number: string; status: OrderStatus; totalCents: number };

/** What the customer is told, once there is an order behind the quote. */
type OrderView =
  | { kind: "none" }
  | { kind: "awaiting_payment"; number: string; totalCents: number }
  | { kind: "in_progress"; number: string; line: string }
  | { kind: "cancelled"; number: string };

/**
 * Every value of the order status enum, spelled out.
 *
 * This used to read "paid = an order exists and is not pending_payment", which
 * meant a cancelled order (`cancelStaleOrder` genuinely creates them) told a
 * customer who had never been charged that their payment had gone through.
 * A new status has to be handled here before the page will compile, so that
 * class of lie cannot come back.
 */
function describeOrder(order: OrderRow): Exclude<OrderView, { kind: "none" }> {
  switch (order.status) {
    case "pending_payment":
      return {
        kind: "awaiting_payment",
        number: order.number,
        totalCents: order.totalCents,
      };
    case "paid":
      return {
        kind: "in_progress",
        number: order.number,
        line: "We'll take it from here.",
      };
    case "processing":
      return {
        kind: "in_progress",
        number: order.number,
        line: "We're preparing it now and will message you at every step.",
      };
    case "fulfilled":
      return {
        kind: "in_progress",
        number: order.number,
        line: "It's done. Everything about your service now lives in your portal.",
      };
    case "cancelled":
      return { kind: "cancelled", number: order.number };
  }
}

/**
 * Public quote link (spec §9.1). The document states both figures the customer
 * is committing to: what is taken on acceptance, and what recurs every month
 * afterwards. It also recovers the case where an order exists but the payment
 * never landed, which used to leave the customer with no way to pay.
 */
export default async function QuotePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const result = await quoteDocument(token);
  if (!result) notFound();
  const { quote, expired, breakdown, rep, company, recipientName } = result;

  // Drive the outcome off the order, not the quote status: an order sitting at
  // pending_payment means the customer still owes us the payment, and one that
  // was cancelled means they owe us nothing at all.
  const [order] = quote.acceptedOrderId
    ? await db
        .select({
          number: orders.number,
          status: orders.status,
          totalCents: orders.totalCents,
        })
        .from(orders)
        .where(eq(orders.id, quote.acceptedOrderId))
        .limit(1)
    : [];
  const view: OrderView = order ? describeOrder(order) : { kind: "none" };

  // wa.me only resolves real mobiles. A rep's `users.phone` is often a desk
  // line and the company number is an 086 share-call, so both routes are
  // filtered through the same guard and the affordance simply disappears when
  // there is nothing behind it.
  //
  // WhatsApp is the extra here, not the promise: when no mobile is configured
  // the customer still gets a route, it is email at the consultant's address
  // or the contact page, never a dead end.
  const repWhatsApp = whatsappHrefFor(
    rep?.phone,
    `Hi${rep?.name ? ` ${rep.name}` : ""}, I have a question about quote ${quote.number}.`
  );
  const companyWhatsApp = whatsappHref(
    company,
    `Hi Needd Connect, I have a question about quote ${quote.number}.`
  );
  const repMail = rep?.email
    ? `mailto:${rep.email}?subject=${encodeURIComponent(`Quote ${quote.number}`)}`
    : null;
  const whatsApp = repWhatsApp ?? companyWhatsApp;
  const chatHref = whatsApp ?? repMail ?? "/contact";
  // The label names the consultant only when the link really goes to them.
  const chatToRep = whatsApp ? Boolean(repWhatsApp) : Boolean(repMail);
  const chatWho = chatToRep && rep?.name ? ` with ${rep.name}` : " with us";
  const chatLabel = whatsApp
    ? repWhatsApp && rep?.name
      ? `WhatsApp ${rep.name}`
      : "WhatsApp us"
    : repMail && rep?.name
      ? `Email ${rep.name}`
      : "Email or phone us";
  const ChatIcon = whatsApp ? MessageCircle : Mail;
  const chatTarget = whatsApp ? "_blank" : undefined;
  const chatRel = whatsApp ? "noreferrer" : undefined;

  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <header className="border-b pb-5">
        <p className="text-sm text-muted-foreground">Your Needd Connect quote</p>
        <h1 className="font-mono text-2xl font-semibold tracking-tight">
          {quote.number}
        </h1>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          {recipientName ? (
            <>
              <dt className="text-muted-foreground">Prepared for</dt>
              <dd className="font-medium">{recipientName}</dd>
            </>
          ) : null}
          <dt className="text-muted-foreground">Issued</dt>
          <dd className="tnum">{formatDateLong(quote.createdAt)}</dd>
          {quote.expiresAt ? (
            <>
              <dt className="text-muted-foreground">
                {expired ? "Expired" : "Valid until"}
              </dt>
              <dd className="tnum">{formatDateLong(quote.expiresAt)}</dd>
            </>
          ) : null}
          {rep?.name ? (
            <>
              <dt className="text-muted-foreground">Your consultant</dt>
              <dd className="font-medium">{rep.name}</dd>
            </>
          ) : null}
        </dl>
      </header>

      <section className="mt-6" aria-labelledby="pay-now-heading">
        <h2 id="pay-now-heading" className="text-sm font-semibold">
          Pay now on acceptance
        </h2>
        <div className="mt-2 overflow-hidden rounded-2xl border bg-card">
          {breakdown.lines.map((line) => (
            <div
              key={line.id}
              className="flex items-start justify-between gap-3 border-b p-3 text-sm last:border-0"
            >
              <span>
                {line.name}
                {line.qty > 1 ? ` × ${line.qty}` : ""}
                {line.discountCents > 0 ? (
                  <span className="block text-xs text-emerald-700">
                    includes <MoneyText cents={line.discountCents} /> discount
                  </span>
                ) : null}
                {line.monthlyCents != null ? (
                  <span className="block text-xs text-muted-foreground">
                    first month plus once-off fees
                  </span>
                ) : null}
              </span>
              <MoneyText cents={line.payNowCents} />
            </div>
          ))}
          <div className="flex items-center justify-between bg-muted/40 p-3 font-semibold">
            <span>Total due on acceptance</span>
            <MoneyText cents={breakdown.payNowCents} />
          </div>
        </div>
      </section>

      {breakdown.hasRecurring ? (
        <section className="mt-5" aria-labelledby="monthly-heading">
          <h2 id="monthly-heading" className="text-sm font-semibold">
            Then per month
          </h2>
          <div className="mt-2 overflow-hidden rounded-2xl border bg-card">
            {breakdown.lines
              .filter((line) => line.monthlyCents != null)
              .map((line) => (
                <div
                  key={`m-${line.id}`}
                  className="flex items-start justify-between gap-3 border-b p-3 text-sm last:border-0"
                >
                  <span>
                    {line.name}
                    {line.qty > 1 ? ` × ${line.qty}` : ""}
                  </span>
                  <span>
                    <MoneyText cents={line.monthlyCents ?? 0} />
                    <span className="text-muted-foreground"> /month</span>
                  </span>
                </div>
              ))}
            <div className="flex items-center justify-between bg-muted/40 p-3 font-semibold">
              <span>Monthly from your second month</span>
              <span>
                <MoneyText cents={breakdown.monthlyCents} />
                <span className="font-normal text-muted-foreground"> /month</span>
              </span>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            This is an ongoing monthly subscription. Your first invoice is only
            for the month after activation, the month you pay on acceptance
            starts when the service works. Monthly billing runs on the same date
            each month and you can cancel with one calendar month&apos;s notice.
          </p>
          {!breakdown.monthlyMatchesQuote ? (
            <p className="mt-2 text-xs font-medium text-amber-700">
              The catalogue price of one of these lines has changed since this
              quote was issued. The amount due on acceptance is still locked to
              the quote; ask {rep?.name ?? "your consultant"} to reissue it if you
              want the monthly figure locked too.
            </p>
          ) : null}
        </section>
      ) : null}

      {view.kind === "in_progress" ? (
        <p className="mt-6 flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <Check className="size-4 shrink-0" aria-hidden />
          Accepted and paid, order {view.number}. {view.line}
        </p>
      ) : view.kind === "awaiting_payment" ? (
        <div className="mt-6 space-y-3 rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-amber-900">
            <RefreshCw className="size-4 shrink-0" aria-hidden />
            Payment not completed
          </p>
          <p className="text-sm text-amber-900">
            We have your details and order {view.number} is waiting, but the
            payment did not go through. Nothing has been charged. Pick up where
            you left off and your quoted price still applies.
          </p>
          <ResumePaymentButton
            token={token}
            label={`Resume payment of ${formatCents(view.totalCents)}`}
          />
          <a
            href={chatHref}
            target={chatTarget}
            rel={chatRel}
            className="inline-flex text-sm font-medium text-amber-900 underline underline-offset-4"
          >
            Rather sort it out{chatWho}
            {whatsApp ? " on WhatsApp" : ""}
          </a>
        </div>
      ) : view.kind === "cancelled" ? (
        <div className="mt-6 space-y-3 rounded-2xl border bg-muted/40 p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <XCircle className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            Order {view.number} was cancelled
          </p>
          <p className="text-sm text-muted-foreground">
            Nothing was charged, and this quote is closed because it is tied to
            that order.{" "}
            {rep?.name
              ? `${rep.name} can send you a fresh one at current prices.`
              : "Ask us for a fresh one at current prices."}
          </p>
          {/* chatLabel carries the rep's name, so the label has no fixed
              length and is allowed to wrap rather than run out of the card. */}
          <PillLink
            href={chatHref}
            target={chatTarget}
            rel={chatRel}
            className="px-7 whitespace-normal"
          >
            <ChatIcon className="size-4 shrink-0" aria-hidden />
            {chatLabel} for a fresh quote
          </PillLink>
        </div>
      ) : expired ? (
        <div className="mt-6 space-y-3 rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">
            This quote link has expired.
          </p>
          <p className="text-sm text-amber-900">
            Prices move, so we do not let an old quote check out at a price we
            can no longer honour.{" "}
            {rep?.name
              ? `${rep.name} can send you a fresh one in a minute.`
              : "Ask us and we will send a fresh one in a minute."}
          </p>
          <PillLink
            href={chatHref}
            target={chatTarget}
            rel={chatRel}
            className="px-7 whitespace-normal"
          >
            <ChatIcon className="size-4 shrink-0" aria-hidden />
            {chatLabel} for a fresh quote
          </PillLink>
        </div>
      ) : (
        <PillLink href={`/q/${token}/accept`} className="mt-6 flex px-7">
          Accept and pay securely
        </PillLink>
      )}

      {view.kind === "none" && !expired ? (
        <p className="mt-3 text-center text-xs text-muted-foreground">
          {rep?.name ? `${rep.name} wrote this quote. ` : ""}Ask anything before
          you pay, it stays exactly as shown.{" "}
          <a
            href={chatHref}
            target={chatTarget}
            rel={chatRel}
            className="font-medium underline underline-offset-4"
          >
            {chatLabel}
          </a>
          .
        </p>
      ) : null}

      <footer className="mt-8 border-t pt-4 text-xs text-muted-foreground">
        {company ? (
          <>
            <p>
              {company.legalName} · Reg {company.reg} · VAT {company.vat}
            </p>
            <p>
              {company.phone} · {company.email} · {company.website}
            </p>
            <p className="mt-1">All amounts shown include VAT.</p>
          </>
        ) : (
          <p>All amounts shown include VAT.</p>
        )}
      </footer>
    </div>
  );
}
