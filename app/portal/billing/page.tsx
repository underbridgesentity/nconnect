import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { CreditCard, Receipt, FileDown } from "lucide-react";
import { db } from "@/lib/db/client";
import { invoices, payments, paymentMethods } from "@/lib/db/schema";
import { currentActor } from "@/lib/auth";
import { payLinkFor } from "@/lib/domain/billing-engine";
import { MoneyText } from "@/components/shared/money-text";
import { StatusPill } from "@/components/shared/status-pill";
import { EmptyState } from "@/components/shared/empty-state";

export const metadata: Metadata = { title: "Billing" };

export default async function PortalBillingPage() {
  const actor = await currentActor();
  if (!actor?.customerId) redirect("/login");
  const customerId = actor.customerId;

  const [invoiceRows, method, paymentRows] = await Promise.all([
    db
      .select()
      .from(invoices)
      .where(eq(invoices.customerId, customerId))
      .orderBy(desc(invoices.issueDate))
      .limit(24),
    db
      .select()
      .from(paymentMethods)
      .where(
        and(
          eq(paymentMethods.customerId, customerId),
          eq(paymentMethods.status, "active")
        )
      )
      .limit(1)
      .then((r) => r[0] ?? null),
    db
      .select({ payment: payments, invoice: invoices })
      .from(payments)
      .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
      .where(
        and(
          eq(invoices.customerId, customerId),
          eq(payments.status, "complete")
        )
      )
      .orderBy(desc(payments.createdAt))
      .limit(12),
  ]);

  const outstanding = invoiceRows.filter((i) =>
    ["open", "past_due"].includes(i.status)
  );
  const dueCents = outstanding.reduce((sum, i) => sum + i.totalCents, 0);

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold tracking-tight">Billing</h1>

      {dueCents > 0 ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-800">
            Outstanding balance: <MoneyText cents={dueCents} />
          </p>
          <a
            href={payLinkFor(outstanding[0].id)}
            className="mt-2 flex touch-target items-center justify-center rounded-md bg-red-600 px-5 text-sm font-medium text-white hover:bg-red-700"
          >
            Pay now
          </a>
        </div>
      ) : (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          Nothing outstanding — you&apos;re all settled.
        </p>
      )}

      <section className="rounded-lg border bg-card p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <CreditCard className="size-4 text-primary" aria-hidden />
          Payment method
        </h2>
        {method ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Card on file{method.cardLast4 ? ` ending ${method.cardLast4}` : ""} —
            monthly invoices are charged automatically. Paying any invoice
            online with a different card replaces it.
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            No card saved yet. Tick &ldquo;save my card&rdquo; when you next
            pay an invoice online and future invoices are charged
            automatically — no more pay links.
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Invoices</h2>
        {invoiceRows.length === 0 ? (
          <EmptyState
            icon={Receipt}
            sentence="No invoices yet. Your first one arrives a month after your service activates."
          />
        ) : (
          invoiceRows.map((invoice) => (
            <div key={invoice.id} className="rounded-lg border bg-card p-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="font-mono text-sm font-medium">
                    {invoice.number}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {invoice.periodStart
                      ? `${invoice.periodStart} → ${invoice.periodEnd}`
                      : `Issued ${invoice.issueDate}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <MoneyText cents={invoice.totalCents} />
                  <StatusPill status={invoice.status} />
                </div>
              </div>
              <div className="mt-2 flex gap-3">
                <a
                  href={`/portal/billing/invoice/${invoice.id}`}
                  className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  <FileDown className="size-3" aria-hidden /> PDF
                </a>
                {["open", "past_due"].includes(invoice.status) ? (
                  <a
                    href={payLinkFor(invoice.id)}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Pay online
                  </a>
                ) : null}
              </div>
            </div>
          ))
        )}
      </section>

      {paymentRows.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Payment history</h2>
          <div className="rounded-lg border bg-card">
            {paymentRows.map(({ payment, invoice }) => (
              <div
                key={payment.id}
                className="flex items-center justify-between border-b p-3 text-sm last:border-0"
              >
                <span className="text-muted-foreground">
                  {payment.createdAt.toISOString().slice(0, 10)} ·{" "}
                  {invoice.number}
                </span>
                <MoneyText cents={payment.amountCents} />
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
