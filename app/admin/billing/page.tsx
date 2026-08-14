import type { Metadata } from "next";
import Link from "next/link";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { Receipt } from "lucide-react";
import { db } from "@/lib/db/client";
import { invoices, customers, payments } from "@/lib/db/schema";
import { ageAnalysis, DEFAULT_DUNNING } from "@/lib/domain/billing-engine";
import { outstandingCents, paidCentsByInvoice } from "@/lib/domain/billing";
import {
  unallocatedPayments,
  unallocatedPaymentsSummary,
} from "@/lib/domain/reports";
import { getSettingOr } from "@/lib/domain/settings";
import { isTaxInvoice, formatVatRate } from "@/lib/domain/vat";
import { formatDate, formatDateTime } from "@/lib/format";
import { paymentMethodLabel } from "../labels";
import { ResolveUnallocatedForm } from "./client";
import { MoneyText } from "@/components/shared/money-text";
import { StatusPill } from "@/components/shared/status-pill";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterPillLink } from "@/components/ui/filter-pill";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Billing" };

const INVOICE_STATUSES = [
  "open",
  "past_due",
  "paid",
  "void",
  "written_off",
] as const;
type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

const FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "past_due", label: "Past due" },
  { key: "paid", label: "Paid" },
  { key: "void", label: "Void" },
  { key: "written_off", label: "Written off" },
];

const PAGE_SIZE = 100;

export default async function AdminBillingPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; tab?: string; q?: string }>;
}) {
  const {
    status = "all",
    tab = "invoices",
    q,
  } = await searchParams;
  const search = q?.trim();
  const pattern = search ? `%${search}%` : null;

  // Invoice number, then customer. Callers quote an invoice number far more
  // often than they remember the name the account is under, and the
  // invoices_number_trgm index exists precisely for this.
  const where = and(
    status === "all" || !INVOICE_STATUSES.includes(status as InvoiceStatus)
      ? undefined
      : eq(invoices.status, status as InvoiceStatus),
    pattern
      ? or(
          ilike(invoices.number, pattern),
          ilike(customers.companyName, pattern),
          ilike(customers.firstName, pattern),
          ilike(customers.lastName, pattern),
          ilike(customers.phone, pattern),
          ilike(customers.email, pattern)
        )
      : undefined
  );

  const [
    invoiceRows,
    [matchCount],
    buckets,
    dunning,
    paymentRows,
    unallocated,
    unallocatedTotals,
  ] = await Promise.all([
      db
        .select({ invoice: invoices, customer: customers })
        .from(invoices)
        .innerJoin(customers, eq(invoices.customerId, customers.id))
        .where(where)
        .orderBy(desc(invoices.issueDate), desc(invoices.number))
        .limit(PAGE_SIZE),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(invoices)
        .innerJoin(customers, eq(invoices.customerId, customers.id))
        .where(where),
      ageAnalysis(),
      getSettingOr("dunning", DEFAULT_DUNNING),
      db
        .select({ payment: payments, invoice: invoices, customer: customers })
        .from(payments)
        .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
        .innerJoin(customers, eq(invoices.customerId, customers.id))
        .orderBy(desc(payments.createdAt))
        .limit(50),
      unallocatedPayments(),
      unallocatedPaymentsSummary(),
    ]);

  const paidByInvoice = await paidCentsByInvoice(
    invoiceRows.map((r) => r.invoice.id)
  );

  const name = (c: typeof customers.$inferSelect) =>
    c.companyName ?? [c.firstName, c.lastName].filter(Boolean).join(" ");

  const bucketTotals = buckets.reduce(
    (sum, b) => ({
      currentCents: sum.currentCents + b.currentCents,
      d30Cents: sum.d30Cents + b.d30Cents,
      d60Cents: sum.d60Cents + b.d60Cents,
      d90Cents: sum.d90Cents + b.d90Cents,
      totalCents: sum.totalCents + b.totalCents,
    }),
    { currentCents: 0, d30Cents: 0, d60Cents: 0, d90Cents: 0, totalCents: 0 }
  );

  const TABS: { key: string; label: string; count?: number }[] = [
    { key: "invoices", label: "Invoices" },
    { key: "age", label: "Age analysis" },
    { key: "payments", label: "Payments" },
    // Money nobody could apply is the one tab that has to announce itself.
    {
      key: "unallocated",
      label: "Unallocated",
      count: unallocatedTotals.count,
    },
    { key: "dunning", label: "Dunning settings" },
  ];

  const headRow = "sticky top-0 z-10 border-b bg-card text-left text-xs text-muted-foreground";

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="text-sm text-muted-foreground">
          Invoices, collections and the dunning timeline.
        </p>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/admin/billing?tab=${t.key}`}
            className={cn(
              "touch-target flex shrink-0 items-center border-b-2 px-3 text-sm font-medium",
              tab === t.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
            {t.count ? (
              <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-white">
                {t.count}
              </span>
            ) : null}
          </Link>
        ))}
      </div>

      {tab === "invoices" ? (
        <>
          <form method="get" action="/admin/billing" className="flex gap-2">
            <input type="hidden" name="tab" value="invoices" />
            {status !== "all" ? (
              <input type="hidden" name="status" value={status} />
            ) : null}
            <Input
              name="q"
              defaultValue={search}
              placeholder="Search invoice number, customer, phone or email…"
              className="max-w-md"
              aria-label="Search invoices"
            />
          </form>

          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <FilterPillLink
                key={f.key}
                href={`/admin/billing?tab=invoices&status=${f.key}${search ? `&q=${encodeURIComponent(search)}` : ""}`}
                active={status === f.key}
              >
                {f.label}
              </FilterPillLink>
            ))}
          </div>

          {invoiceRows.length === 0 ? (
            <EmptyState
              icon={Receipt}
              description={
                search
                  ? `No invoices match "${search}". Try the invoice number, or part of the customer's name.`
                  : "No invoices match this filter yet. Recurring invoices are generated nightly on each service's billing anchor."
              }
            />
          ) : (
            <>
              <div className="max-h-[70vh] overflow-auto rounded-lg border bg-card">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className={headRow}>
                      <th className="p-3 font-medium">Invoice</th>
                      <th className="p-3 font-medium">Customer</th>
                      <th className="p-3 font-medium">Issued</th>
                      <th className="p-3 font-medium">Due</th>
                      <th className="p-3 text-right font-medium">Excl. VAT</th>
                      <th className="p-3 text-right font-medium">VAT</th>
                      <th className="p-3 text-right font-medium">Total</th>
                      <th className="p-3 text-right font-medium">Outstanding</th>
                      <th className="p-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoiceRows.map(({ invoice, customer }) => {
                      const paid = paidByInvoice.get(invoice.id) ?? 0;
                      const collectable =
                        invoice.status === "open" ||
                        invoice.status === "past_due";
                      return (
                        <tr key={invoice.id} className="border-b last:border-0">
                          <td className="p-3 font-mono text-xs">
                            <Link
                              href={`/admin/customers/${customer.id}?tab=billing`}
                              className="hover:underline"
                            >
                              {invoice.number}
                            </Link>
                          </td>
                          <td className="p-3">
                            <Link
                              href={`/admin/customers/${customer.id}?tab=billing`}
                              className="text-primary hover:underline"
                            >
                              {name(customer)}
                            </Link>
                          </td>
                          <td className="p-3 text-muted-foreground">
                            {formatDate(invoice.issueDate)}
                          </td>
                          <td className="p-3 text-muted-foreground">
                            {formatDate(invoice.dueDate)}
                          </td>
                          <td className="p-3 text-right text-muted-foreground">
                            <MoneyText cents={invoice.subtotalCents} />
                          </td>
                          {/*
                            VAT is read off the invoice's own snapshot, not
                            today's setting, so an invoice raised before the
                            company registered shows a dash rather than a rate
                            it was never charged at.
                          */}
                          <td className="p-3 text-right text-muted-foreground">
                            {isTaxInvoice(invoice) &&
                            invoice.vatCents !== null &&
                            invoice.vatRateBasisPoints !== null ? (
                              <span
                                title={`VAT at ${formatVatRate(invoice.vatRateBasisPoints)}`}
                              >
                                <MoneyText cents={invoice.vatCents} />
                              </span>
                            ) : (
                              <span aria-label="No VAT on this invoice">-</span>
                            )}
                          </td>
                          <td className="p-3 text-right">
                            <MoneyText cents={invoice.totalCents} />
                          </td>
                          <td className="p-3 text-right">
                            {collectable ? (
                              <MoneyText
                                cents={outstandingCents(
                                  invoice.totalCents,
                                  paid
                                )}
                                className={cn(
                                  invoice.status === "past_due" &&
                                    "font-medium text-red-600"
                                )}
                              />
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                          <td className="p-3">
                            <StatusPill status={invoice.status} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">
                {matchCount.n > invoiceRows.length
                  ? `Showing the ${invoiceRows.length} most recent of ${matchCount.n} matching invoices. Search or filter to narrow it down.`
                  : `Showing all ${matchCount.n} matching invoice${matchCount.n === 1 ? "" : "s"}.`}
              </p>
            </>
          )}
        </>
      ) : null}

      {tab === "age" ? (
        buckets.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="Nothing outstanding"
            description="Every invoice is settled."
          />
        ) : (
          <div className="max-h-[70vh] overflow-auto rounded-lg border bg-card">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className={headRow}>
                  <th className="p-3 font-medium">Customer</th>
                  <th className="p-3 text-right font-medium">Current</th>
                  <th className="p-3 text-right font-medium">30 days</th>
                  <th className="p-3 text-right font-medium">60 days</th>
                  <th className="p-3 text-right font-medium">90+ days</th>
                  <th className="p-3 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {buckets.map((b) => (
                  <tr key={b.customerId} className="border-b last:border-0">
                    <td className="p-3">
                      <Link
                        href={`/admin/customers/${b.customerId}?tab=billing`}
                        className="text-primary hover:underline"
                      >
                        {b.customerName}
                      </Link>
                    </td>
                    <td className="p-3 text-right">
                      <MoneyText cents={b.currentCents} />
                    </td>
                    <td className="p-3 text-right">
                      <MoneyText cents={b.d30Cents} />
                    </td>
                    <td className="p-3 text-right">
                      <MoneyText cents={b.d60Cents} />
                    </td>
                    <td className="p-3 text-right">
                      <MoneyText
                        cents={b.d90Cents}
                        className={cn(b.d90Cents > 0 && "text-red-600")}
                      />
                    </td>
                    <td className="p-3 text-right font-medium">
                      <MoneyText cents={b.totalCents} />
                    </td>
                  </tr>
                ))}
              </tbody>
              {/* The first number a collections lead needs is the total. */}
              <tfoot>
                <tr className="border-t bg-muted/40 font-medium">
                  <td className="p-3">
                    Total owed, {buckets.length} customer
                    {buckets.length === 1 ? "" : "s"}
                  </td>
                  <td className="p-3 text-right">
                    <MoneyText cents={bucketTotals.currentCents} />
                  </td>
                  <td className="p-3 text-right">
                    <MoneyText cents={bucketTotals.d30Cents} />
                  </td>
                  <td className="p-3 text-right">
                    <MoneyText cents={bucketTotals.d60Cents} />
                  </td>
                  <td className="p-3 text-right">
                    <MoneyText
                      cents={bucketTotals.d90Cents}
                      className={cn(bucketTotals.d90Cents > 0 && "text-red-600")}
                    />
                  </td>
                  <td className="p-3 text-right">
                    <MoneyText cents={bucketTotals.totalCents} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )
      ) : null}

      {tab === "payments" ? (
        paymentRows.length === 0 ? (
          <EmptyState icon={Receipt} title="No payments recorded yet" />
        ) : (
          <div className="max-h-[70vh] overflow-auto rounded-lg border bg-card">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className={headRow}>
                  <th className="p-3 font-medium">Date received</th>
                  <th className="p-3 font-medium">Customer</th>
                  <th className="p-3 font-medium">Invoice</th>
                  <th className="p-3 font-medium">Method</th>
                  <th className="p-3 text-right font-medium">Amount</th>
                  <th className="p-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {paymentRows.map(({ payment, invoice, customer }) => (
                  <tr key={payment.id} className="border-b last:border-0">
                    <td className="p-3 text-muted-foreground">
                      {formatDate(payment.createdAt)}
                    </td>
                    <td className="p-3">
                      <Link
                        href={`/admin/customers/${customer.id}?tab=billing`}
                        className="text-primary hover:underline"
                      >
                        {name(customer)}
                      </Link>
                    </td>
                    <td className="p-3 font-mono text-xs">{invoice.number}</td>
                    <td className="p-3">{paymentMethodLabel(payment.method)}</td>
                    <td className="p-3 text-right">
                      <MoneyText cents={payment.amountCents} />
                    </td>
                    <td className="p-3">
                      <StatusPill status={payment.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {tab === "unallocated" ? (
        unallocated.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="Nothing waiting to be allocated"
            description="Every rand PayFast has taken has landed on an invoice that could absorb it."
          />
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Money PayFast took that the invoice it named could not absorb: an
              overpayment, or a debit against an invoice that was already
              settled, voided or written off. It is banked and audited against
              that invoice already. What is missing is the decision, so allocate
              it to another invoice or refund it, then record which here.
            </p>
            <div className="rounded-lg border border-amber-300 bg-amber-50/50 p-3 text-sm dark:bg-amber-950/20">
              <MoneyText
                cents={unallocatedTotals.unallocatedCents}
                className="font-semibold"
              />{" "}
              across {unallocatedTotals.count} payment
              {unallocatedTotals.count === 1 ? "" : "s"}
              {unallocatedTotals.count > unallocated.length
                ? `, showing the ${unallocated.length} that have waited longest`
                : ""}
              .
            </div>

            {unallocated.map((row) => (
              <div
                key={row.eventId}
                className="rounded-lg border bg-card p-4 text-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <Link
                      href={`/admin/customers/${row.customerId}?tab=billing`}
                      className="font-medium text-primary hover:underline"
                    >
                      {row.customerName || "(no name)"}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      Arrived for{" "}
                      <span className="font-mono">{row.invoiceNumber}</span> on{" "}
                      {formatDateTime(row.receivedAt)} by{" "}
                      {paymentMethodLabel(row.method)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Gateway reference{" "}
                      <span className="font-mono">{row.gatewayRef}</span>
                    </p>
                    {row.statusOnArrival &&
                    row.statusOnArrival !== row.invoiceStatus ? (
                      <p className="text-xs text-muted-foreground">
                        The invoice was{" "}
                        {row.statusOnArrival.replace("_", " ")} when the money
                        arrived.
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2 text-right">
                    <div>
                      <MoneyText
                        cents={row.unallocatedCents}
                        className="font-semibold text-amber-700"
                      />
                      <p className="text-xs text-muted-foreground">
                        of <MoneyText cents={row.amountCents} className="text-xs" />{" "}
                        received
                      </p>
                    </div>
                    <StatusPill status={row.invoiceStatus} />
                  </div>
                </div>
                {row.reason ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {row.reason}
                  </p>
                ) : null}
                <ResolveUnallocatedForm
                  gatewayRef={row.gatewayRef}
                  invoiceId={row.invoiceId}
                />
              </div>
            ))}
          </div>
        )
      ) : null}

      {tab === "dunning" ? (
        <div className="max-w-lg space-y-3">
          <p className="text-sm text-muted-foreground">
            The collections timeline, relative to each invoice&apos;s issue
            date. Values come from settings; this view is read-only.
          </p>
          <div className="rounded-lg border bg-card text-sm">
            {[
              ["Day 0", "Invoice issued; card charge attempt #1 if a token exists"],
              [`Day +${dunning.chargeAttemptDays[1] ?? 2}`, "Charge attempt #2 + payment-failed notice with pay link"],
              [`Day +${dunning.chargeAttemptDays[2] ?? 5}`, "Charge attempt #3 + reminder"],
              [`Day +${dunning.pastDueDay}`, "Invoice becomes past due, “pay within 3 days to avoid suspension”"],
              [`Day +${dunning.suspendDay}`, "Service suspended (reactivates automatically on settlement)"],
              [`Day +${dunning.adminDecisionDay}`, "Admin decision required: cancel the service or write the invoice off, nothing automatic"],
            ].map(([day, what]) => (
              <div key={day} className="flex gap-4 border-b p-3 last:border-0">
                <span className="w-20 shrink-0 font-mono text-xs font-medium">
                  {day}
                </span>
                <span className="text-muted-foreground">{what}</span>
              </div>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            Void, write-off and credit live on each invoice in the customer&apos;s
            Billing tab, and the day-40 decisions are queued on{" "}
            <Link href="/admin" className="font-medium text-primary hover:underline">
              Today
            </Link>
            .
          </p>
        </div>
      ) : null}
    </div>
  );
}
