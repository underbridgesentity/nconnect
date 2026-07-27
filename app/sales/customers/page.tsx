import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import { Users } from "lucide-react";
import { db } from "@/lib/db/client";
import { customers } from "@/lib/db/schema";
import { currentActor } from "@/lib/auth";
import { normalizePhone } from "@/lib/auth/otp";
import { EmptyState } from "@/components/shared/empty-state";

export const metadata: Metadata = { title: "My customers" };

/** Name, company, email, or a phone number typed 082…, 27… or +27…. */
function searchPredicate(term: string): SQL | undefined {
  const like = `%${term}%`;
  const clauses: SQL[] = [
    ilike(customers.firstName, like),
    ilike(customers.lastName, like),
    ilike(customers.companyName, like),
    ilike(customers.email, like),
  ];
  const digits = term.replace(/[\s()-]/g, "");
  if (/\d{3,}/.test(digits)) {
    try {
      clauses.push(eq(customers.phone, normalizePhone(digits)));
    } catch {
      clauses.push(ilike(customers.phone, `%${digits.replace(/^(\+27|27|0)/, "")}%`));
    }
  }
  return or(...clauses);
}

export default async function SalesCustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const actor = await currentActor();
  if (!actor) redirect("/staff-login");
  const search = q?.trim() ?? "";

  // §12: sales sees only customers assigned to them.
  const rows = await db
    .select()
    .from(customers)
    .where(
      and(
        actor.role === "admin"
          ? undefined
          : eq(customers.assignedSalesId, actor.userId),
        search ? searchPredicate(search) : undefined
      )
    )
    .orderBy(desc(customers.createdAt))
    .limit(100);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My customers</h1>
        <p className="text-sm text-muted-foreground">
          Customers attributed to you, read-only view of their services and
          billing status.
        </p>
      </div>

      <form action="/sales/customers" className="flex flex-wrap gap-2">
        <input
          type="search"
          name="q"
          defaultValue={search}
          placeholder="Name, company, number or email"
          aria-label="Search customers"
          className="h-11 min-w-48 flex-1 rounded-full border bg-background px-4 text-sm"
        />
        <button
          type="submit"
          className="touch-target rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-[#0f5a91]"
        >
          Search
        </button>
        {search ? (
          <Link
            href="/sales/customers"
            className="touch-target inline-flex items-center rounded-full border px-5 text-sm font-medium hover:bg-accent"
          >
            Clear
          </Link>
        ) : null}
      </form>

      {rows.length === 0 ? (
        <EmptyState
          icon={Users}
          sentence={
            search
              ? `Nobody in your book matches "${search}".`
              : "No customers yet. When one of your quotes is accepted and paid, the customer lands here, attributed to you."
          }
        />
      ) : (
        <div className="space-y-2">
          {rows.map((customer) => {
            const name =
              customer.companyName ??
              [customer.firstName, customer.lastName].filter(Boolean).join(" ");
            return (
              <Link
                key={customer.id}
                href={`/sales/customers/${customer.id}`}
                className="block rounded-2xl border bg-card p-4 hover:border-primary/40"
              >
                <p className="font-medium">{name || "(no name)"}</p>
                <p className="text-xs text-muted-foreground">
                  {customer.phone}
                  {customer.email ? ` · ${customer.email}` : ""}
                </p>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
