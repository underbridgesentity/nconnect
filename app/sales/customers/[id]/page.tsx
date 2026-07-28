import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  customers,
  services,
  plans,
  invoices,
  conversations,
} from "@/lib/db/schema";
import { currentActor } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { EmptyState } from "@/components/shared/empty-state";
import { MoneyText } from "@/components/shared/money-text";
import { StatusPill } from "@/components/shared/status-pill";
import { isUuid } from "@/lib/utils";
import { BackLink } from "../../back-link";

export const metadata: Metadata = { title: "Customer" };

/** Read-only 360 subset for reps (§9.5, §12): services, invoice STATUSES, conversations. */
export default async function SalesCustomer360({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // A malformed id would reach Postgres as an invalid uuid and throw a
  // 500 instead of the 404 the visitor should see.
  if (!isUuid(id)) notFound();
  const actor = await currentActor();
  if (!actor) redirect("/staff-login");

  const [customer] = await db
    .select()
    .from(customers)
    .where(eq(customers.id, id))
    .limit(1);
  if (!customer) notFound();
  // A rep can never load another rep's customer by URL (§12, M7 acceptance).
  if (actor.role !== "admin" && customer.assignedSalesId !== actor.userId) {
    notFound();
  }

  const [serviceRows, invoiceRows, convRows] = await Promise.all([
    db
      .select({ service: services, plan: plans })
      .from(services)
      .innerJoin(plans, eq(services.planId, plans.id))
      .where(eq(services.customerId, id)),
    db
      .select({
        id: invoices.id,
        number: invoices.number,
        status: invoices.status,
        issueDate: invoices.issueDate,
      })
      .from(invoices)
      .where(eq(invoices.customerId, id))
      .orderBy(desc(invoices.issueDate))
      .limit(12),
    db
      .select()
      .from(conversations)
      .where(eq(conversations.customerId, id))
      .orderBy(desc(conversations.lastMessageAt))
      .limit(10),
  ]);

  const name =
    customer.companyName ??
    [customer.firstName, customer.lastName].filter(Boolean).join(" ");

  return (
    <div className="space-y-6">
      <div>
        <BackLink href="/sales/customers">My customers</BackLink>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{name}</h1>
        <p className="text-sm text-muted-foreground">
          {customer.phone}
          {customer.email ? ` · ${customer.email}` : ""}
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Services</h2>
        {serviceRows.length === 0 ? (
          <EmptyState compact title="No services yet" />
        ) : (
          serviceRows.map(({ service, plan }) => (
            <div
              key={service.id}
              className="flex items-center justify-between rounded-lg border bg-card p-3 text-sm"
            >
              <span>{plan.name}</span>
              <span className="flex items-center gap-2">
                <MoneyText cents={plan.priceCents} whole />
                <StatusPill status={service.status} />
              </span>
            </div>
          ))
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Invoice statuses</h2>
        {invoiceRows.length === 0 ? (
          <EmptyState compact title="No invoices yet" />
        ) : (
          <div className="rounded-lg border bg-card">
            {invoiceRows.map((invoice) => (
              <div
                key={invoice.id}
                className="flex items-center justify-between border-b p-3 text-sm last:border-0"
              >
                <span className="font-mono text-xs">{invoice.number}</span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="tnum">{formatDate(invoice.issueDate)}</span>
                  <StatusPill status={invoice.status} />
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Conversations</h2>
        {convRows.length === 0 ? (
          <EmptyState compact title="No conversations" />
        ) : (
          convRows.map((c) => (
            <Link
              key={c.id}
              href={`/admin/inbox?c=${c.id}`}
              className="flex items-center justify-between rounded-lg border bg-card p-3 text-sm hover:border-primary/40"
            >
              <span>{c.subject ?? c.channel}</span>
              <StatusPill status={c.status} />
            </Link>
          ))
        )}
      </section>
    </div>
  );
}
