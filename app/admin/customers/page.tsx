import type { Metadata } from "next";
import Link from "next/link";
import { ilike, or, sql, eq, desc } from "drizzle-orm";
import { Users, Download } from "lucide-react";
import { db } from "@/lib/db/client";
import {
  customers,
  users,
  services,
  invoices,
  sims,
  providerAccounts,
} from "@/lib/db/schema";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusPill } from "@/components/shared/status-pill";

export const metadata: Metadata = { title: "Customers" };

const PAGE_SIZE = 100;

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const search = q?.trim();
  const pattern = search ? `%${search}%` : null;

  /**
   * Inbound support calls start with an identifier, not a name: an invoice
   * number, the SIM in the router, the MSISDN, or the provider's own
   * reference. Every one of those resolves to the customer here.
   */
  const where = pattern
    ? or(
        ilike(customers.firstName, pattern),
        ilike(customers.lastName, pattern),
        ilike(customers.companyName, pattern),
        ilike(customers.phone, pattern),
        ilike(customers.email, pattern),
        sql`exists (select 1 from ${invoices} where ${invoices.customerId} = ${customers.id} and ${invoices.number} ilike ${pattern})`,
        sql`exists (select 1 from ${sims} join ${services} on ${services.id} = ${sims.serviceId} where ${services.customerId} = ${customers.id} and (${sims.iccid} ilike ${pattern} or ${sims.msisdn} ilike ${pattern}))`,
        sql`exists (select 1 from ${providerAccounts} where ${providerAccounts.customerId} = ${customers.id} and (${providerAccounts.externalRef} ilike ${pattern} or ${providerAccounts.msisdn} ilike ${pattern} or ${providerAccounts.circuitId} ilike ${pattern}))`
      )
    : undefined;

  const [rows, [matchCount]] = await Promise.all([
    db
      .select({
        customer: customers,
        repName: users.name,
        serviceCount: sql<number>`(select count(*) from ${services} where ${services.customerId} = ${customers.id})::int`,
      })
      .from(customers)
      .leftJoin(users, eq(customers.assignedSalesId, users.id))
      .where(where)
      .orderBy(desc(customers.createdAt))
      .limit(PAGE_SIZE),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(customers)
      .where(where),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Customers</h1>
          <p className="text-sm text-muted-foreground">
            Every customer, their services and balance, one page each.
          </p>
        </div>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- file download, not navigation */}
        <a
          href="/admin/customers/export"
          className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
        >
          <Download className="size-3.5" /> Export CSV
        </a>
      </div>

      <form method="get" action="/admin/customers">
        <Input
          name="q"
          defaultValue={search}
          placeholder="Name, company, phone, email, invoice number, SIM or MSISDN…"
          className="max-w-md"
          aria-label="Search customers"
        />
      </form>

      {rows.length === 0 ? (
        <EmptyState
          icon={Users}
          description={
            search
              ? `No customers match "${search}". Try an invoice number, a SIM number or the phone number they are calling from.`
              : "No customers yet. They appear here the moment someone signs up, or when a sales quote is accepted and paid."
          }
        />
      ) : (
        <div className="max-h-[70vh] overflow-auto rounded-lg border bg-card">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="sticky top-0 z-10 border-b bg-card text-left text-xs text-muted-foreground">
                <th className="p-3 font-medium">Customer</th>
                <th className="p-3 font-medium">Phone</th>
                <th className="p-3 font-medium">Rep</th>
                <th className="p-3 text-right font-medium">Services</th>
                <th className="p-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ customer, repName, serviceCount }) => {
                const name =
                  customer.companyName ??
                  [customer.firstName, customer.lastName]
                    .filter(Boolean)
                    .join(" ");
                return (
                  <tr key={customer.id} className="border-b last:border-0 hover:bg-accent/40">
                    <td className="p-3">
                      <Link
                        href={`/admin/customers/${customer.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {name || "(no name)"}
                      </Link>
                      {customer.email ? (
                        <span className="block text-xs text-muted-foreground">
                          {customer.email}
                        </span>
                      ) : null}
                    </td>
                    <td className="p-3">{customer.phone}</td>
                    <td className="p-3 text-muted-foreground">
                      {repName ?? "-"}
                    </td>
                    <td className="tnum p-3 text-right">{serviceCount}</td>
                    <td className="p-3">
                      <StatusPill status={customer.status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {matchCount.n > rows.length
            ? `Showing the ${rows.length} most recent of ${matchCount.n} matching customers. Search to narrow it down.`
            : `Showing all ${matchCount.n} customer${matchCount.n === 1 ? "" : "s"}.`}
        </p>
      ) : null}
    </div>
  );
}
