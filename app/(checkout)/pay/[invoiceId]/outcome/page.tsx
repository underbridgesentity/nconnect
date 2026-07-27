import type { Metadata } from "next";
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { CheckCircle2, Clock, FileX2, MessageCircle, Phone } from "lucide-react";
import { db } from "@/lib/db/client";
import { invoices, payments } from "@/lib/db/schema";
import { currentActor } from "@/lib/auth";
import { verifyPayLinkToken } from "@/lib/domain/billing-engine";
import { getSetting } from "@/lib/domain/settings";
import { add, subtract, type Cents } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { MoneyText } from "@/components/shared/money-text";
import { StatusPill } from "@/components/shared/status-pill";
import {
  CTA,
  CTA_SECONDARY,
  ExpiredLink,
  whatsappHref,
  type Company,
} from "../../_lib/pay-chrome";

export const metadata: Metadata = {
  title: "Payment status",
  robots: { index: false, follow: false },
};

/** Stop refreshing after this long and hand the payer a person instead. */
const MAX_POLL_SECONDS = 45;
const POLL_INTERVAL_SECONDS = 4;

/**
 * Where PayFast returns an invoice payer (spec §6.2).
 *
 * The redirect proves nothing: it happens whether or not the money moved, and
 * it can be reached by typing the URL. The only thing that settles an invoice
 * is the signed ITN webhook, so this page reads the invoice back out of the
 * database and reports exactly what is recorded there, no more. It refreshes
 * itself for a short while because the ITN usually lands within seconds, then
 * stops and offers a human rather than spinning forever.
 */
export default async function PayOutcomePage({
  params,
  searchParams,
}: {
  params: Promise<{ invoiceId: string }>;
  searchParams: Promise<{ t?: string; tries?: string }>;
}) {
  const { invoiceId } = await params;
  const { t, tries } = await searchParams;
  const company = await getSetting<Company>("company");

  if (!t || !verifyPayLinkToken(invoiceId, t)) {
    return <ExpiredLink company={company} />;
  }

  const [invoice] = await db
    .select()
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  if (!invoice) return <ExpiredLink company={company} />;

  // Completed payments only: an initiated row is a payment we started, not
  // money we hold, and this page must never count it as received.
  const received = await db
    .select({ amountCents: payments.amountCents })
    .from(payments)
    .where(
      and(eq(payments.invoiceId, invoiceId), eq(payments.status, "complete"))
    );
  const paidCents: Cents = received.reduce(
    (sum, p) => add(sum, p.amountCents),
    0
  );
  const balanceCents = subtract(invoice.totalCents, paidCents);

  /**
   * Four honest states, all read from the database rather than the redirect:
   * `paid` is the ITN's own verdict; `received` is every cent accounted for on
   * an invoice the engine has not closed off yet; `closed` is void or written
   * off, where no confirmation is ever coming; `waiting` is everything else.
   */
  const state =
    invoice.status === "paid"
      ? "paid"
      : balanceCents <= 0
        ? "received"
        : invoice.status === "void" || invoice.status === "written_off"
          ? "closed"
          : "waiting";
  const settled = state === "paid" || state === "received";
  const closed = state === "closed";

  const attempt = Number.isFinite(Number(tries))
    ? Math.max(0, Number(tries))
    : 0;
  const keepPolling =
    state === "waiting" && attempt * POLL_INTERVAL_SECONDS < MAX_POLL_SECONDS;
  const nextUrl = `/pay/${invoice.id}/outcome?t=${encodeURIComponent(t)}&tries=${attempt + 1}`;
  const restartUrl = `/pay/${invoice.id}/outcome?t=${encodeURIComponent(t)}&tries=0`;

  const actor = await currentActor();
  const ownsInvoice = actor?.customerId === invoice.customerId;
  const wa = whatsappHref(
    company,
    `Hi Needd Connect, I am checking on a payment for invoice ${invoice.number}.`
  );

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      {keepPolling ? (
        <meta
          httpEquiv="refresh"
          content={`${POLL_INTERVAL_SECONDS};url=${nextUrl}`}
        />
      ) : null}

      <div className="text-center">
        {settled ? (
          <CheckCircle2
            className="mx-auto size-10 text-emerald-600"
            aria-hidden
          />
        ) : closed ? (
          <FileX2 className="mx-auto size-10 text-muted-foreground" aria-hidden />
        ) : (
          <Clock className="mx-auto size-10 text-primary" aria-hidden />
        )}
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">
          {state === "paid"
            ? "Payment confirmed"
            : state === "received"
              ? "We have the full amount"
              : state === "closed"
                ? `This invoice is ${invoice.status.replace("_", " ")}`
                : keepPolling
                  ? "Waiting for PayFast to confirm"
                  : "Still waiting on PayFast"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {state === "paid" ? (
            <>
              PayFast has confirmed it and invoice{" "}
              <span className="font-mono">{invoice.number}</span> is settled.
              Thank you.
            </>
          ) : state === "received" ? (
            <>
              Every cent of invoice{" "}
              <span className="font-mono">{invoice.number}</span> is accounted
              for and we are busy allocating it. Nothing further is due from
              you.
            </>
          ) : state === "closed" ? (
            <>
              Invoice <span className="font-mono">{invoice.number}</span> is no
              longer collecting payment. If you were charged for it, tell us and
              we will trace the payment and put it right.
            </>
          ) : (
            <>
              Coming back to this page is not proof that anything was charged.
              We only mark an invoice paid once PayFast sends us its signed
              confirmation, and that has not arrived for invoice{" "}
              <span className="font-mono">{invoice.number}</span> yet.
            </>
          )}
        </p>
      </div>

      <div className="mt-6 overflow-hidden rounded-2xl border bg-card">
        <div className="flex items-center justify-between gap-3 border-b p-3 text-sm">
          <span className="text-muted-foreground">Invoice total</span>
          <MoneyText cents={invoice.totalCents} />
        </div>
        <div className="flex items-center justify-between gap-3 border-b p-3 text-sm">
          <span className="text-muted-foreground">
            Confirmed against this invoice
          </span>
          <MoneyText cents={paidCents} />
        </div>
        <div className="flex items-center justify-between gap-3 border-b bg-muted/40 p-3 font-semibold">
          <span>
            {closed
              ? "Not being collected"
              : balanceCents > 0
                ? "Still outstanding"
                : "Nothing due"}
          </span>
          <MoneyText cents={Math.max(0, balanceCents)} />
        </div>
        <div className="flex items-center justify-between gap-3 p-3 text-sm">
          <span className="text-muted-foreground">
            Due {formatDate(invoice.dueDate)}
          </span>
          <StatusPill status={invoice.status} />
        </div>
      </div>

      {!settled && !closed ? (
        <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {keepPolling
            ? "Leave this page open, it rechecks itself every few seconds and confirmation usually lands in well under a minute. If your bank already shows the amount, nothing is lost, the confirmation is simply still on its way."
            : "If your card was charged, nothing is lost. PayFast occasionally takes a few minutes, and we message you the moment the confirmation lands. If it never does, tell us the amount and the time and we will trace it with PayFast."}
        </p>
      ) : null}

      <div className="mt-6 space-y-3">
        {ownsInvoice ? (
          <Link href="/portal/billing" className={CTA}>
            Open your billing
          </Link>
        ) : (
          <Link href="/login" className={CTA}>
            Sign in to your portal
          </Link>
        )}
        {!settled && !keepPolling ? (
          <div className="flex flex-wrap justify-center gap-3">
            {!closed ? (
              <Link href={restartUrl} className={CTA_SECONDARY}>
                Check again
              </Link>
            ) : null}
            {wa ? (
              <a href={wa} className={CTA_SECONDARY}>
                <MessageCircle className="mr-2 size-4" aria-hidden />
                WhatsApp us
              </a>
            ) : null}
            {company?.phone ? (
              <a
                href={`tel:${company.phone.replace(/\s/g, "")}`}
                className={CTA_SECONDARY}
              >
                <Phone className="mr-2 size-4" aria-hidden />
                {company.phone}
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
