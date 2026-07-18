import type { Metadata } from "next";
import Link from "next/link";
import { ilike, or, sql, eq, desc } from "drizzle-orm";
import { Users, Download } from "lucide-react";
import { db } from "@/lib/db/client";
import { customers, users, services } from "@/lib/db/schema";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusPill } from "@/components/shared/status-pill";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const pattern = q ? `%${q}%` : null;

  const rows = await db
    .select({
      customer: customers,
      repName: users.name,
      serviceCount: sql<number>`(select count(*) from ${services} where ${services.customerId} = ${customers.id})::int`,
    })
    .from(customers)
    .leftJoin(users, eq(customers.assignedSalesId, users.id))
    .where(
      pattern
        ? or(
            ilike(customers.firstName, pattern),
            ilike(customers.lastName, pattern),
            ilike(customers.companyName, pattern),
            ilike(customers.phone, pattern),
            ilike(customers.email, pattern)
          )
        : undefined
    )
    .orderBy(desc(customers.createdAt))
    .limit(100);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Customers</h1>
          <p className="text-sm text-muted-foreground">
            Every customer, their services and balance — one page each.
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
          defaultValue={q}
          placeholder="Search name, company, phone or email…"
          className="max-w-md"
          aria-label="Search customers"
        />
      </form>

      {rows.length === 0 ? (
        <EmptyState
          icon={Users}
          sentence={
            q
              ? `No customers match "${q}".`
              : "No customers yet. They appear here the moment someone signs up or you create one from an assisted order."
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
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
                      {repName ?? "—"}
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
    </div>
  );
}
