import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { CheckCircle2 } from "lucide-react";
import { db } from "@/lib/db/client";
import { invoices, invoiceLines, customers } from "@/lib/db/schema";
import { verifyPayLinkToken } from "@/lib/domain/billing-engine";
import { buildCheckout } from "@/lib/payfast";
import { MoneyText } from "@/components/shared/money-text";
import { StatusPill } from "@/components/shared/status-pill";

export const metadata: Metadata = {
  title: "Pay invoice",
  robots: { index: false, follow: false },
};

/**
 * Pay link (spec §6.2/§6.3): tokenised public URL sent in invoice and
 * dunning notifications. Server-rendered; the PayFast form posts directly.
 */
export default async function PayInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ invoiceId: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { invoiceId } = await params;
  const { t } = await searchParams;
  if (!t || !verifyPayLinkToken(invoiceId, t)) notFound();

  const [invoice] = await db
    .select()
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  if (!invoice) notFound();
  const lines = await db
    .select()
    .from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, invoiceId));
  const [customer] = await db
    .select()
    .from(customers)
    .where(eq(customers.id, invoice.customerId))
    .limit(1);

  const payable = invoice.status === "open" || invoice.status === "past_due";

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">
        Invoice {invoice.number}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {customer?.companyName ??
          [customer?.firstName, customer?.lastName].filter(Boolean).join(" ")}
      </p>

      <div className="mt-6 rounded-lg border bg-card">
        {lines.map((line) => (
          <div
            key={line.id}
            className="flex items-center justify-between border-b p-3 text-sm last:border-0"
          >
            <span>{line.description}</span>
            <MoneyText cents={line.amountCents} />
          </div>
        ))}
        <div className="flex items-center justify-between p-3 font-semibold">
          <span>Total due</span>
          <MoneyText cents={invoice.totalCents} />
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          Due {invoice.dueDate}
        </span>
        <StatusPill status={invoice.status} />
      </div>

      {invoice.status === "paid" ? (
        <p className="mt-6 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          <CheckCircle2 className="size-5" aria-hidden />
          This invoice is settled — thank you.
        </p>
      ) : payable ? (
        <PayForm invoiceId={invoice.id} />
      ) : (
        <p className="mt-6 rounded-lg border p-4 text-sm text-muted-foreground">
          This invoice is {invoice.status.replace("_", " ")} and can&apos;t be
          paid online. Contact us if something looks wrong.
        </p>
      )}
    </div>
  );
}

async function PayForm({ invoiceId }: { invoiceId: string }) {
  const [invoice] = await db
    .select()
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  if (!invoice) return null;
  const checkout = buildCheckout({
    paymentId: `inv:${invoice.id}`,
    amountCents: invoice.totalCents,
    itemName: `Needd Connect invoice ${invoice.number}`,
    tokenize: true,
  });
  return (
    <form action={checkout.actionUrl} method="post" className="mt-6">
      {Object.entries(checkout.fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button
        type="submit"
        className="flex w-full touch-target items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Pay securely with PayFast
      </button>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        Prefer EFT? The banking details are on your invoice PDF — reference{" "}
        {invoice.number}.
      </p>
    </form>
  );
}
