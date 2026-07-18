import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { Receipt } from "lucide-react";
import { db } from "@/lib/db/client";
import { invoices, customers, payments } from "@/lib/db/schema";
import { ageAnalysis, DEFAULT_DUNNING } from "@/lib/domain/billing-engine";
import { getSettingOr } from "@/lib/domain/settings";
import { MoneyText } from "@/components/shared/money-text";
import { StatusPill } from "@/components/shared/status-pill";
import { EmptyState } from "@/components/shared/empty-state";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Billing" };

const FILTERS = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "past_due", label: "Past due" },
  { key: "paid", label: "Paid" },
];

export default async function AdminBillingPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; tab?: string }>;
}) {
  const { status = "all", tab = "invoices" } = await searchParams;

  const invoiceRows = await db
    .select({ invoice: invoices, customer: customers })
    .from(invoices)
    .innerJoin(customers, eq(invoices.customerId, customers.id))
    .where(
      status === "all"
        ? undefined
        : inArray(invoices.status, [status as "open" | "past_due" | "paid"])
    )
    .orderBy(desc(invoices.issueDate))
    .limit(100);

  const [buckets, dunning, paymentRows] = await Promise.all([
    ageAnalysis(),
    getSettingOr("dunning", DEFAULT_DUNNING),
    db
      .select({ payment: payments, invoice: invoices, customer: customers })
      .from(payments)
      .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
      .innerJoin(customers, eq(invoices.customerId, customers.id))
      .orderBy(desc(payments.createdAt))
      .limit(50),
  ]);

  const name = (c: typeof customers.$inferSelect) =>
    c.companyName ?? [c.firstName, c.lastName].filter(Boolean).join(" ");

  const TABS = [
    { key: "invoices", label: "Invoices" },
    { key: "age", label: "Age analysis" },
    { key: "payments", label: "Payments" },
    { key: "dunning", label: "Dunning settings" },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="text-sm text-muted-foreground">
          Invoices, collections and the dunning timeline.
        </p>
      </div>

      <div className="flex gap-1 border-b">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/admin/billing?tab=${t.key}`}
            className={cn(
              "touch-target flex items-center border-b-2 px-3 text-sm font-medium",
              tab === t.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "invoices" ? (
        <>
          <div className="flex gap-2">
            {FILTERS.map((f) => (
              <Link
                key={f.key}
                href={`/admin/billing?tab=invoices&status=${f.key}`}
                className={cn(
                  "rounded-full px-3 py-1 text-sm",
                  status === f.key
                    ? "bg-primary font-medium text-primary-foreground"
                    : "border text-muted-foreground hover:bg-accent"
                )}
              >
                {f.label}
              </Link>
            ))}
          </div>
          {invoiceRows.length === 0 ? (
            <EmptyState
              icon={Receipt}
              sentence="No invoices match this filter yet. Recurring invoices are generated nightly on each service's billing anchor."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border bg-card">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="p-3 font-medium">Invoice</th>
                    <th className="p-3 font-medium">Customer</th>
                    <th className="p-3 font-medium">Issued</th>
                    <th className="p-3 font-medium">Due</th>
                    <th className="p-3 text-right font-medium">Total</th>
                    <th className="p-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {invoiceRows.map(({ invoice, customer }) => (
                    <tr key={invoice.id} className="border-b last:border-0">
                      <td className="p-3 font-mono text-xs">{invoice.number}</td>
                      <td className="p-3">
                        <Link
                          href={`/admin/customers/${customer.id}?tab=billing`}
                          className="text-primary hover:underline"
                        >
                          {name(customer)}
                        </Link>
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {invoice.issueDate}
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {invoice.dueDate}
                      </td>
                      <td className="p-3 text-right">
                        <MoneyText cents={invoice.totalCents} />
                      </td>
                      <td className="p-3">
                        <StatusPill status={invoice.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}

      {tab === "age" ? (
        buckets.length === 0 ? (
          <EmptyState
            icon={Receipt}
            sentence="Nothing outstanding — every invoice is settled."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
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
            </table>
          </div>
        )
      ) : null}

      {tab === "payments" ? (
        paymentRows.length === 0 ? (
          <EmptyState icon={Receipt} sentence="No payments recorded yet." />
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="p-3 font-medium">Date</th>
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
                      {payment.createdAt.toISOString().slice(0, 10)}
                    </td>
                    <td className="p-3">{name(customer)}</td>
                    <td className="p-3 font-mono text-xs">{invoice.number}</td>
                    <td className="p-3">{payment.method}</td>
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
              [`Day +${dunning.pastDueDay}`, "Invoice becomes past due — “pay within 3 days to avoid suspension”"],
              [`Day +${dunning.suspendDay}`, "Service suspended (reactivates automatically on settlement)"],
              [`Day +${dunning.adminDecisionDay}`, "Admin decision required: cancel or write off — nothing automatic"],
            ].map(([day, what]) => (
              <div key={day} className="flex gap-4 border-b p-3 last:border-0">
                <span className="w-20 shrink-0 font-mono text-xs font-medium">
                  {day}
                </span>
                <span className="text-muted-foreground">{what}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
