import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq, or, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  customers,
  users,
  services,
  plans,
  providers,
  invoices,
  payments,
  orders,
  conversations,
  ricaRecords,
  auditLog,
  addresses,
} from "@/lib/db/schema";
import {
  customerBalanceCents,
  paidCentsByInvoice,
  collectionAttemptsFor,
} from "@/lib/domain/billing";
import { maskedIdNumber } from "@/lib/domain/rica";
import { todayInJohannesburg } from "@/lib/domain/services";
import { formatDate, formatDateTime } from "@/lib/format";
import { actorLabel, paymentMethodLabel } from "../../labels";
import { MoneyText } from "@/components/shared/money-text";
import { StatusPill } from "@/components/shared/status-pill";
import { cn, isUuid } from "@/lib/utils";
import {
  EditDetailsSheet,
  AssignRepSelect,
  NotesForm,
  RecordEftForm,
  MarkOrderPaidForm,
  ServiceActions,
  InvoiceActions,
} from "./client";

export const metadata: Metadata = { title: "Customer" };

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "services", label: "Services" },
  { key: "billing", label: "Billing" },
  { key: "conversations", label: "Conversations" },
  { key: "documents", label: "Documents & RICA" },
  { key: "audit", label: "Audit trail" },
  { key: "notes", label: "Notes" },
];

export default async function Customer360Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  // A malformed id would reach Postgres as an invalid uuid and throw a
  // 500 instead of the 404 the visitor should see.
  if (!isUuid(id)) notFound();
  const { tab = "overview" } = await searchParams;

  const [customer] = await db
    .select()
    .from(customers)
    .where(eq(customers.id, id))
    .limit(1);
  if (!customer) notFound();

  const name =
    customer.companyName ??
    [customer.firstName, customer.lastName].filter(Boolean).join(" ");

  const [balance, reps, serviceRows, invoiceRows, orderRows, ricaSummary] =
    await Promise.all([
      customerBalanceCents(id),
      db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(or(eq(users.role, "sales"), eq(users.role, "admin"))),
      db
        .select({ service: services, plan: plans, provider: providers })
        .from(services)
        .innerJoin(plans, eq(services.planId, plans.id))
        .innerJoin(providers, eq(plans.providerId, providers.id))
        .where(eq(services.customerId, id)),
      db
        .select()
        .from(invoices)
        .where(eq(invoices.customerId, id))
        .orderBy(desc(invoices.issueDate)),
      db
        .select()
        .from(orders)
        .where(eq(orders.customerId, id))
        .orderBy(desc(orders.createdAt)),
      db
        .select({ status: ricaRecords.status })
        .from(ricaRecords)
        .where(eq(ricaRecords.customerId, id)),
    ]);

  // What has actually been banked against each invoice, so a partly paid
  // invoice can show what is still outstanding instead of the full total.
  const openInvoiceIds = invoiceRows
    .filter((i) => i.status === "open" || i.status === "past_due")
    .map((i) => i.id);
  const [paidByInvoice, attempts] = await Promise.all([
    paidCentsByInvoice(invoiceRows.map((i) => i.id)),
    collectionAttemptsFor(openInvoiceIds),
  ]);

  const today = todayInJohannesburg();
  const activeServices = serviceRows.filter(
    (s) => s.service.status === "active"
  ).length;
  const nextInvoiceDate = serviceRows
    .map((s) => s.service.nextInvoiceDate)
    .filter((d): d is string => Boolean(d))
    .sort()[0];
  const ricaState =
    ricaSummary.length === 0
      ? null
      : ricaSummary.some((r) => r.status === "pending")
        ? "RICA pending"
        : ricaSummary.every((r) => r.status === "verified")
          ? "RICA verified"
          : "RICA rejected";

  const facts: [string, string][] = [
    ["Customer since", formatDate(customer.createdAt)],
    [
      "Services",
      activeServices === serviceRows.length
        ? `${serviceRows.length} active`
        : `${activeServices} active of ${serviceRows.length}`,
    ],
    ["Next invoice", nextInvoiceDate ? formatDate(nextInvoiceDate) : "None scheduled"],
    ...(ricaState ? ([["Compliance", ricaState]] as [string, string][]) : []),
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/admin/customers"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Customers
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {name || "(no name)"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {customer.phone} {customer.email ? `· ${customer.email}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Outstanding</p>
            <MoneyText
              cents={balance}
              className={cn("text-lg font-semibold", balance > 0 && "text-red-600")}
            />
          </div>
          <StatusPill status={customer.status} />
          <EditDetailsSheet customer={customer} />
        </div>
      </div>

      {/* The brief an operator needs before picking up the phone. */}
      <dl className="flex flex-wrap gap-x-6 gap-y-2 rounded-2xl border bg-card px-4 py-3 text-sm">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">Sales rep:</span>
        <AssignRepSelect
          customerId={id}
          current={customer.assignedSalesId}
          reps={reps}
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto border-b">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/admin/customers/${id}?tab=${t.key}`}
            className={cn(
              "touch-target flex shrink-0 items-center border-b-2 px-3 text-sm font-medium",
              tab === t.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "overview" || tab === "services" ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Services</h2>
          {serviceRows.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              No services yet. They are created automatically when an order is
              paid.
            </p>
          ) : (
            serviceRows.map(({ service, plan, provider }) => (
              <div key={service.id} className="rounded-lg border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">{plan.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {provider.name}
                      {service.activationDate
                        ? ` · active since ${formatDate(service.activationDate)}`
                        : ""}
                      {service.nextInvoiceDate
                        ? ` · next invoice ${formatDate(service.nextInvoiceDate)}`
                        : ""}
                    </p>
                    {service.cancelEffectiveDate ? (
                      <p className="text-sm text-amber-700">
                        Cancels {formatDate(service.cancelEffectiveDate)}
                        {service.cancelReason ? `, ${service.cancelReason}` : ""}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <MoneyText cents={plan.priceCents} whole className="text-sm" />
                    <StatusPill status={service.status} />
                    <ServiceActions
                      serviceId={service.id}
                      customerId={id}
                      status={service.status}
                      planName={plan.name}
                      customerName={name || "this customer"}
                    />
                  </div>
                </div>
              </div>
            ))
          )}
        </section>
      ) : null}

      {tab === "billing" ? (
        <section className="space-y-6">
          {orderRows.filter((o) => o.status === "pending_payment").length > 0 ? (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold">Orders awaiting payment</h2>
              {orderRows
                .filter((o) => o.status === "pending_payment")
                .map((order) => (
                  <div key={order.id} className="rounded-lg border bg-card p-4">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{order.number}</span>
                      <MoneyText cents={order.totalCents} />
                    </div>
                    <MarkOrderPaidForm
                      orderId={order.id}
                      customerId={id}
                      amountCents={order.totalCents}
                    />
                  </div>
                ))}
            </div>
          ) : null}

          <div className="space-y-3">
            <h2 className="text-sm font-semibold">Invoices</h2>
            {invoiceRows.length === 0 ? (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                No invoices yet.
              </p>
            ) : (
              invoiceRows.map((invoice) => {
                const paid = paidByInvoice.get(invoice.id) ?? 0;
                const outstanding = invoice.totalCents - paid;
                const collectable =
                  invoice.status === "open" || invoice.status === "past_due";
                const invoiceAttempts = attempts.filter(
                  (a) => a.invoiceId === invoice.id
                );
                return (
                  <div key={invoice.id} className="rounded-lg border bg-card p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-mono text-sm font-medium">
                          {invoice.number}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Issued {formatDate(invoice.issueDate)} · due{" "}
                          {formatDate(invoice.dueDate)}
                          {invoice.periodStart
                            ? ` · ${formatDate(invoice.periodStart)} to ${formatDate(invoice.periodEnd)}`
                            : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="text-right">
                          <MoneyText cents={invoice.totalCents} />
                          {paid > 0 && collectable ? (
                            <p className="text-xs text-muted-foreground">
                              <MoneyText cents={paid} className="text-xs" /> paid,{" "}
                              <MoneyText
                                cents={outstanding}
                                className="text-xs font-medium text-red-600"
                              />{" "}
                              outstanding
                            </p>
                          ) : null}
                        </div>
                        <StatusPill status={invoice.status} />
                        {collectable ? (
                          <InvoiceActions
                            invoiceId={invoice.id}
                            invoiceNumber={invoice.number}
                            customerId={id}
                            customerName={name || "this customer"}
                            outstandingCents={outstanding}
                            hasPayments={paid > 0}
                          />
                        ) : null}
                      </div>
                    </div>

                    {/* What the bank actually said, so the operator on the
                        phone can name the reason instead of guessing. */}
                    {invoiceAttempts.length > 0 ? (
                      <ul className="mt-3 space-y-1 border-t pt-3 text-xs">
                        {invoiceAttempts.map((attempt) => (
                          <li
                            key={attempt.id}
                            className={cn(
                              "flex flex-wrap items-baseline gap-x-2",
                              attempt.result === "failed"
                                ? "text-red-600"
                                : "text-muted-foreground"
                            )}
                          >
                            <span className="font-medium">
                              Card attempt {attempt.attemptNo}
                            </span>
                            <span>
                              {attempt.executedAt
                                ? formatDateTime(attempt.executedAt)
                                : `scheduled ${formatDateTime(attempt.scheduledFor)}`}
                            </span>
                            <span>
                              {attempt.result
                                ? `${attempt.result}${attempt.detail ? `, ${attempt.detail}` : ""}`
                                : "not attempted yet"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {collectable ? (
                      <RecordEftForm
                        invoiceId={invoice.id}
                        customerId={id}
                        outstandingCents={outstanding}
                        today={today}
                      />
                    ) : null}
                  </div>
                );
              })
            )}
          </div>

          <PaymentsLog customerId={id} />
        </section>
      ) : null}

      {tab === "conversations" ? (
        <ConversationsTab customerId={id} />
      ) : null}

      {tab === "documents" ? <DocumentsTab customerId={id} /> : null}

      {tab === "audit" ? <AuditTab customerId={id} serviceIds={serviceRows.map((s) => s.service.id)} /> : null}

      {tab === "notes" ? (
        <NotesForm customerId={id} notes={customer.notes ?? ""} />
      ) : null}

      {tab === "overview" ? <RecentActivity customerId={id} /> : null}
    </div>
  );
}

async function PaymentsLog({ customerId }: { customerId: string }) {
  const rows = await db
    .select({ payment: payments, invoice: invoices })
    .from(payments)
    .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
    .where(eq(invoices.customerId, customerId))
    .orderBy(desc(payments.createdAt))
    .limit(30);
  if (rows.length === 0) return null;
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold">Payments</h2>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="p-3 font-medium">Date</th>
              <th className="p-3 font-medium">Invoice</th>
              <th className="p-3 font-medium">Method</th>
              <th className="p-3 text-right font-medium">Amount</th>
              <th className="p-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ payment, invoice }) => (
              <tr key={payment.id} className="border-b last:border-0">
                <td className="p-3 text-muted-foreground">
                  {formatDate(payment.createdAt)}
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
    </div>
  );
}

async function ConversationsTab({ customerId }: { customerId: string }) {
  const rows = await db
    .select()
    .from(conversations)
    .where(eq(conversations.customerId, customerId))
    .orderBy(desc(conversations.lastMessageAt));
  return (
    <section className="space-y-3">
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          No conversations with this customer yet. Portal messages and inbound
          WhatsApp land here the moment they arrive.
        </p>
      ) : (
        rows.map((c) => (
          <Link
            key={c.id}
            href={`/admin/inbox?c=${c.id}`}
            className="flex items-center justify-between rounded-lg border bg-card p-4 hover:border-primary/40"
          >
            <span>
              <span className="font-medium">{c.subject ?? c.channel}</span>
              <span className="block text-xs text-muted-foreground">
                {c.channel}
              </span>
            </span>
            <StatusPill status={c.status} />
          </Link>
        ))
      )}
    </section>
  );
}

async function DocumentsTab({ customerId }: { customerId: string }) {
  const rica = await db
    .select()
    .from(ricaRecords)
    .where(eq(ricaRecords.customerId, customerId));
  const addressRows = await db
    .select()
    .from(addresses)
    .where(eq(addresses.customerId, customerId));
  return (
    <section className="space-y-6">
      <div className="space-y-3">
        <h2 className="text-sm font-semibold">RICA records</h2>
        {rica.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            No RICA records, this customer has no SIM-based services.
          </p>
        ) : (
          rica.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between rounded-lg border bg-card p-4"
            >
              <div>
                <p className="font-mono text-sm">{maskedIdNumber(r.idNumberEncrypted)}</p>
                <p className="text-xs text-muted-foreground">
                  Captured {formatDate(r.createdAt)}
                  {r.rejectionReason ? ` · rejected: ${r.rejectionReason}` : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  Documents open from the Today queue verification flow; every
                  access is logged. Retained 5 years after termination.
                </p>
              </div>
              <StatusPill status={r.status} />
            </div>
          ))
        )}
      </div>
      <div className="space-y-3">
        <h2 className="text-sm font-semibold">Addresses</h2>
        {addressRows.map((a) => (
          <p key={a.id} className="rounded-lg border bg-card p-4 text-sm">
            {[a.line1, a.line2, a.suburb, a.city, a.postalCode]
              .filter(Boolean)
              .join(", ")}
            {a.isPrimary ? (
              <span className="ml-2 text-xs text-muted-foreground">primary</span>
            ) : null}
          </p>
        ))}
      </div>
    </section>
  );
}

async function AuditTab({
  customerId,
  serviceIds,
}: {
  customerId: string;
  serviceIds: string[];
}) {
  const entityIds = [customerId, ...serviceIds];
  // An audit trail that cannot name the actor fails the purpose it exists
  // for, so join the user behind actor_user_id (§12, POPIA).
  const rows = await db
    .select({ entry: auditLog, actorName: users.name })
    .from(auditLog)
    .leftJoin(users, eq(auditLog.actorUserId, users.id))
    .where(inArray(auditLog.entityId, entityIds))
    .orderBy(desc(auditLog.createdAt))
    .limit(50);
  return (
    <section className="space-y-2">
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          No audited actions yet.
        </p>
      ) : (
        rows.map(({ entry, actorName }) => (
          <div key={entry.id} className="rounded-lg border bg-card p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-xs font-medium">{entry.action}</span>
              <span className="text-xs text-muted-foreground">
                {formatDateTime(entry.createdAt)} · {actorLabel(actorName, entry.actorRole)}
              </span>
            </div>
            {entry.after ? (
              <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                {JSON.stringify(entry.after)}
              </p>
            ) : null}
          </div>
        ))
      )}
    </section>
  );
}

async function RecentActivity({ customerId }: { customerId: string }) {
  const rows = await db
    .select({ entry: auditLog, actorName: users.name })
    .from(auditLog)
    .leftJoin(users, eq(auditLog.actorUserId, users.id))
    .where(eq(auditLog.entityId, customerId))
    .orderBy(desc(auditLog.createdAt))
    .limit(8);
  if (rows.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">Recent activity</h2>
      {rows.map(({ entry, actorName }) => (
        <p key={entry.id} className="text-sm text-muted-foreground">
          <span className="font-mono text-xs">{entry.action}</span>,{" "}
          {formatDateTime(entry.createdAt)},{" "}
          {actorLabel(actorName, entry.actorRole)}
        </p>
      ))}
    </section>
  );
}
