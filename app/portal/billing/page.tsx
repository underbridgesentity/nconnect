import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq, inArray } from "drizzle-orm";
import { CheckCircle2, Clock, CreditCard, Receipt, FileDown } from "lucide-react";
import { db } from "@/lib/db/client";
import { invoices, payments, paymentMethods } from "@/lib/db/schema";
import { currentActor } from "@/lib/auth";
import {
  payLinkFor,
  DEFAULT_DUNNING,
  type DunningConfig,
} from "@/lib/domain/billing-engine";
import { getSettingOr } from "@/lib/domain/settings";
import { todayInJohannesburg } from "@/lib/domain/services";
import { formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { MoneyText } from "@/components/shared/money-text";
import { StatusPill } from "@/components/shared/status-pill";
import { EmptyState } from "@/components/shared/empty-state";
import {
  paidCentsByInvoice,
  withBalance,
  isOpen,
  type InvoiceWithBalance,
} from "../_lib/balances";
import { outstandingLine } from "../_lib/invoice-copy";

export const metadata: Metadata = { title: "Billing" };

/**
 * Pay links opened from the portal come back to the portal, not to the public
 * pay-link outcome page, so a signed-in customer stays inside the app.
 */
function portalPayLink(invoiceId: string): string {
  return `${payLinkFor(invoiceId)}&from=portal`;
}

export default async function PortalBillingPage({
  searchParams,
}: {
  searchParams: Promise<{ paid?: string; checked?: string }>;
}) {
  const actor = await currentActor();
  if (!actor?.customerId) redirect("/login");
  const customerId = actor.customerId;
  const { paid, checked } = await searchParams;

  const [invoiceRows, openRows, method, paymentRows, paidByInvoice, dunning] =
    await Promise.all([
      db
        .select()
        .from(invoices)
        .where(eq(invoices.customerId, customerId))
        .orderBy(desc(invoices.issueDate))
        .limit(24),
      // The banner must count every unpaid invoice, not just the last 24, so
      // the figure here can never disagree with the one on the home screen.
      db
        .select()
        .from(invoices)
        .where(
          and(
            eq(invoices.customerId, customerId),
            inArray(invoices.status, ["open", "past_due"])
          )
        ),
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
      paidCentsByInvoice(customerId),
      getSettingOr<DunningConfig>("dunning", DEFAULT_DUNNING),
    ]);

  // Balance, not invoice total: a part-paid invoice stays open by design, and
  // telling someone they owe money they have already sent is unforgivable.
  const rows = invoiceRows.map((invoice) =>
    withBalance(invoice, paidByInvoice.get(invoice.id))
  );
  const outstanding = openRows
    .map((invoice) => withBalance(invoice, paidByInvoice.get(invoice.id)))
    .filter((row) => row.balanceCents > 0);
  const dueCents = outstanding.reduce((sum, row) => sum + row.balanceCents, 0);
  const oldest = [...outstanding].sort((a, b) =>
    a.invoice.dueDate.localeCompare(b.invoice.dueDate)
  )[0];
  const today = todayInJohannesburg();

  // PayFast has returned a payer to us. The redirect is not proof of anything,
  // so the banner reports what is actually recorded against that invoice and
  // says plainly when the confirmation has not landed yet.
  const returnedNumber = paid?.trim().slice(0, 32) || null;
  let returned: InvoiceWithBalance | null = null;
  if (returnedNumber) {
    // The list above is capped, and the number is always scoped to this
    // customer so one person's reference can never surface another's invoice.
    returned = rows.find((row) => row.invoice.number === returnedNumber) ?? null;
    if (!returned) {
      const [row] = await db
        .select()
        .from(invoices)
        .where(
          and(
            eq(invoices.customerId, customerId),
            eq(invoices.number, returnedNumber)
          )
        )
        .limit(1);
      returned = row ? withBalance(row, paidByInvoice.get(row.id)) : null;
    }
  }
  const returnSettled =
    returned !== null &&
    (returned.invoice.status === "paid" || returned.balanceCents <= 0);
  const checkAttempt = Number.isFinite(Number(checked))
    ? Math.max(0, Number(checked))
    : 0;

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold tracking-tight">Billing</h1>

      {returned ? (
        returnSettled ? (
          <p className="flex gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              PayFast has confirmed your payment and invoice{" "}
              <span className="font-mono">{returned.invoice.number}</span> is
              settled. Thank you.
            </span>
          </p>
        ) : (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="flex gap-2">
              <Clock className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                You are back from PayFast, which on its own does not tell us
                whether the payment went through. Invoice{" "}
                <span className="font-mono">{returned.invoice.number}</span> is
                still showing{" "}
                <MoneyText cents={returned.balanceCents} /> outstanding here.
                Confirmation usually reaches us within seconds.
              </span>
            </p>
            <Link
              href={`/portal/billing?paid=${encodeURIComponent(returned.invoice.number)}&checked=${checkAttempt + 1}`}
              className="mt-3 flex touch-target items-center justify-center rounded-full border border-amber-300 bg-white px-5 text-sm font-medium hover:bg-amber-100"
            >
              Check again
            </Link>
          </div>
        )
      ) : null}

      {dueCents > 0 && oldest ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-800">
            Outstanding balance: <MoneyText cents={dueCents} />
          </p>
          <p className="mt-1 text-xs text-red-700">
            {outstandingLine({
              number: oldest.invoice.number,
              status: oldest.invoice.status,
              issueDate: oldest.invoice.issueDate,
              dueDate: oldest.invoice.dueDate,
              hasService: Boolean(oldest.invoice.serviceId),
              suspendDay: dunning.suspendDay,
              today,
            })}
          </p>
          {oldest.partiallyPaid ? (
            <p className="mt-1 text-xs text-red-700">
              We have received <MoneyText cents={oldest.paidCents} /> of{" "}
              <MoneyText cents={oldest.invoice.totalCents} /> on it. Pay the
              remaining <MoneyText cents={oldest.balanceCents} /> by EFT using
              reference {oldest.invoice.number}, or ask us in Help for a link
              for the balance.
            </p>
          ) : null}
          {oldest.partiallyPaid ? (
            <Button
              variant="outline"
              className="mt-3 w-full touch-target"
              render={<Link href="/portal/help" />}
            >
              Ask about this balance
            </Button>
          ) : (
            <a
              href={portalPayLink(oldest.invoice.id)}
              className="mt-3 flex touch-target items-center justify-center rounded-full bg-red-600 px-5 text-sm font-medium text-white transition-colors hover:bg-red-700"
            >
              Pay <MoneyText cents={oldest.balanceCents} /> now
            </a>
          )}
        </div>
      ) : (
        <p className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          Nothing outstanding, you&apos;re all settled.
        </p>
      )}

      <section className="rounded-2xl border bg-card p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <CreditCard className="size-4 text-primary" aria-hidden />
          Payment method
        </h2>
        {method ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Card saved on {formatDate(method.createdAt)}
            {method.cardLast4 ? `, ending ${method.cardLast4}` : ""}. Your
            monthly invoices are charged to it automatically, and we send you
            each invoice either way. To change or remove the card, message us
            in Help.
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            No card saved. Every invoice arrives with a pay link you can settle
            by card, or you can EFT using the invoice number as the reference.
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Invoices</h2>
        {rows.length === 0 ? (
          <EmptyState
            icon={Receipt}
            sentence="No invoices yet. Your first one arrives a month after your service activates."
          />
        ) : (
          rows.map(
            ({
              invoice,
              paidCents,
              balanceCents,
              partiallyPaid,
              lastPaymentAt,
            }) => (
              <div key={invoice.id} className="rounded-2xl border bg-card p-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="font-mono text-sm font-medium">
                      {invoice.number}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {invoice.periodStart
                        ? `${formatDate(invoice.periodStart)} to ${formatDate(invoice.periodEnd)}`
                        : `Issued ${formatDate(invoice.issueDate)}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <MoneyText cents={invoice.totalCents} />
                    <StatusPill status={invoice.status} />
                  </div>
                </div>
                {partiallyPaid ? (
                  <p className="mt-2 text-xs text-amber-700">
                    <MoneyText cents={balanceCents} /> still due of{" "}
                    <MoneyText cents={invoice.totalCents} />,{" "}
                    <MoneyText cents={paidCents} /> received
                    {lastPaymentAt ? ` on ${formatDate(lastPaymentAt)}` : ""}.
                  </p>
                ) : null}
                <div className="mt-2 flex gap-3">
                  <a
                    href={`/portal/billing/invoice/${invoice.id}`}
                    aria-label={`Download invoice ${invoice.number} as PDF`}
                    className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    <FileDown className="size-3" aria-hidden /> PDF
                  </a>
                  {isOpen(invoice) && balanceCents > 0 && !partiallyPaid ? (
                    <a
                      href={portalPayLink(invoice.id)}
                      aria-label={`Pay invoice ${invoice.number} online`}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      Pay online
                    </a>
                  ) : null}
                  {partiallyPaid ? (
                    <span className="text-xs text-muted-foreground">
                      Pay the balance by EFT, reference {invoice.number}
                    </span>
                  ) : null}
                </div>
              </div>
            )
          )
        )}
      </section>

      {paymentRows.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Payment history</h2>
          <div className="rounded-2xl border bg-card">
            {paymentRows.map(({ payment, invoice }) => (
              <div
                key={payment.id}
                className="flex items-center justify-between border-b p-3 text-sm last:border-0"
              >
                <span className="text-muted-foreground">
                  {formatDate(payment.createdAt)} ·{" "}
                  <span className="font-mono">{invoice.number}</span>
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
