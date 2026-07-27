import type { Metadata } from "next";
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { CheckCircle2, Lock, MessageCircle } from "lucide-react";
import { db } from "@/lib/db/client";
import { invoices, invoiceLines, customers, payments } from "@/lib/db/schema";
import { verifyPayLinkToken } from "@/lib/domain/billing-engine";
import { getSetting } from "@/lib/domain/settings";
import { buildCheckout } from "@/lib/payfast";
import { add, subtract, type Cents } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { MoneyText } from "@/components/shared/money-text";
import { StatusPill } from "@/components/shared/status-pill";

export const metadata: Metadata = {
  title: "Pay invoice",
  robots: { index: false, follow: false },
};

type Company = {
  legalName: string;
  phone: string;
  email: string;
  vat: string;
  reg: string;
};

const CTA =
  "flex w-full touch-target items-center justify-center rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 hover:bg-[#0f5a91]";

/**
 * Pay link (spec §6.2/§6.3): tokenised public URL sent in invoice and
 * dunning notifications. Server-rendered; the PayFast form posts directly.
 * It arrives by SMS or WhatsApp, so it has to look unmistakably like us:
 * legal name, registration, VAT and a support route on the page itself.
 */
export default async function PayInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ invoiceId: string }>;
  searchParams: Promise<{ t?: string; cancelled?: string }>;
}) {
  const { invoiceId } = await params;
  const { t } = await searchParams;
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

  const lines = await db
    .select()
    .from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, invoiceId));
  const [customer] = await db
    .select()
    .from(customers)
    .where(eq(customers.id, invoice.customerId))
    .limit(1);

  // Money already received against this invoice. Partial payments are
  // supported and leave the invoice open, so the page must never present the
  // full total to somebody who has already paid part of it.
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

  const payable = invoice.status === "open" || invoice.status === "past_due";
  const customerName =
    customer?.companyName ??
    [customer?.firstName, customer?.lastName].filter(Boolean).join(" ");
  const wa = company?.phone
    ? `https://wa.me/27${company.phone.replace(/\D/g, "").replace(/^0/, "")}`
    : null;

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">
        Invoice <span className="font-mono">{invoice.number}</span>
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">{customerName}</p>

      <div className="mt-6 overflow-hidden rounded-2xl border bg-card">
        {lines.map((line) => (
          <div
            key={line.id}
            className="flex items-center justify-between gap-3 border-b p-3 text-sm last:border-0"
          >
            <span>{line.description}</span>
            <MoneyText cents={line.amountCents} className="shrink-0" />
          </div>
        ))}
        <div className="flex items-center justify-between border-t p-3 text-sm">
          <span>Invoice total</span>
          <MoneyText cents={invoice.totalCents} />
        </div>
        {paidCents > 0 ? (
          <div className="flex items-center justify-between border-t p-3 text-sm text-muted-foreground">
            <span>Already received</span>
            <MoneyText cents={paidCents} />
          </div>
        ) : null}
        <div className="flex items-center justify-between border-t bg-muted/40 p-3 font-semibold">
          <span>{paidCents > 0 ? "Balance due" : "Total due"}</span>
          <MoneyText cents={balanceCents} />
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          Due {formatDate(invoice.dueDate)}
        </span>
        <StatusPill status={invoice.status} />
      </div>

      {invoice.status === "paid" ? (
        <p className="mt-6 flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          <CheckCircle2 className="size-5 shrink-0" aria-hidden />
          This invoice is settled, thank you.
        </p>
      ) : !payable ? (
        <p className="mt-6 rounded-2xl border p-4 text-sm text-muted-foreground">
          This invoice is {invoice.status.replace("_", " ")} and can&apos;t be
          paid online. Contact us if something looks wrong.
        </p>
      ) : balanceCents <= 0 ? (
        <p className="mt-6 rounded-2xl border p-4 text-sm text-muted-foreground">
          We have received the full amount for this invoice and are busy
          allocating it. Nothing further is due.
        </p>
      ) : paidCents > 0 ? (
        // Card payments settle the whole invoice, so we never put a button on
        // screen that would take more than the customer owes.
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium">
            Balance of <MoneyText cents={balanceCents} /> outstanding
          </p>
          <p className="mt-1">
            Because part of this invoice is already paid, card payment here
            would take the full amount again. Message us and we will take the
            balance only, or pay it by EFT using reference {invoice.number}.
          </p>
          {wa ? (
            <a href={wa} className={`mt-3 ${CTA}`}>
              WhatsApp us to settle {invoice.number}
            </a>
          ) : null}
        </div>
      ) : (
        <PayForm
          invoiceId={invoice.id}
          invoiceNumber={invoice.number}
          amountCents={balanceCents}
        />
      )}

      <div className="mt-6 space-y-2 rounded-2xl border bg-card p-4 text-xs text-muted-foreground">
        <p className="flex gap-2">
          <Lock className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <span>
            Payment is taken on PayFast&apos;s secure page. We never see or
            store your card number.
          </span>
        </p>
        {wa ? (
          <p className="flex gap-2">
            <MessageCircle
              className="mt-0.5 size-4 shrink-0 text-primary"
              aria-hidden
            />
            <span>
              Not sure this link is really from us?{" "}
              <a href={wa} className="text-primary hover:underline">
                WhatsApp us
              </a>{" "}
              or call {company?.phone} and quote invoice {invoice.number}.
            </span>
          </p>
        ) : null}
        {company ? (
          <p className="pt-1">
            {company.legalName} | Reg {company.reg} | VAT {company.vat}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function PayForm({
  invoiceId,
  invoiceNumber,
  amountCents,
}: {
  invoiceId: string;
  invoiceNumber: string;
  amountCents: Cents;
}) {
  const checkout = buildCheckout({
    paymentId: `inv:${invoiceId}`,
    amountCents,
    itemName: `Needd Connect invoice ${invoiceNumber}`,
    tokenize: true,
  });
  return (
    <form action={checkout.actionUrl} method="post" className="mt-6">
      {Object.entries(checkout.fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button type="submit" className={CTA}>
        Pay <MoneyText cents={amountCents} className="mx-1" /> securely with
        PayFast
      </button>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        Prefer EFT? The banking details are on your invoice PDF, reference{" "}
        <span className="font-mono">{invoiceNumber}</span>.
      </p>
    </form>
  );
}

function ExpiredLink({ company }: { company: Company | null }) {
  const wa = company?.phone
    ? `https://wa.me/27${company.phone.replace(/\D/g, "").replace(/^0/, "")}`
    : null;
  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">This payment link has expired</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Pay links are single-invoice and time-limited for your safety. Sign in
        to your portal to see and pay everything outstanding, or ask us for a
        fresh link.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link href="/login" className={CTA}>
          Sign in to your portal
        </Link>
        {wa ? (
          <a
            href={wa}
            className="inline-flex touch-target items-center justify-center rounded-full border px-6 text-sm font-medium hover:bg-accent"
          >
            WhatsApp us for a new link
          </a>
        ) : null}
      </div>
      {company ? (
        <p className="mt-8 text-xs text-muted-foreground">
          {company.legalName} | Reg {company.reg} | VAT {company.vat}
        </p>
      ) : null}
    </div>
  );
}
