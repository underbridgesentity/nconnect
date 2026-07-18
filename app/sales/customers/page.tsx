import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { Users } from "lucide-react";
import { db } from "@/lib/db/client";
import { customers } from "@/lib/db/schema";
import { currentActor } from "@/lib/auth";
import { EmptyState } from "@/components/shared/empty-state";

export const metadata: Metadata = { title: "My customers" };

export default async function SalesCustomersPage() {
  const actor = await currentActor();
  if (!actor) redirect("/staff-login");

  // §12: sales sees only customers assigned to them.
  const rows = await db
    .select()
    .from(customers)
    .where(
      actor.role === "admin"
        ? undefined
        : eq(customers.assignedSalesId, actor.userId)
    )
    .orderBy(desc(customers.createdAt))
    .limit(100);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My customers</h1>
        <p className="text-sm text-muted-foreground">
          Customers attributed to you — read-only view of their services and
          billing status.
        </p>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon={Users}
          sentence="No customers yet. When one of your quotes is accepted and paid, the customer lands here, attributed to you."
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
                className="block rounded-lg border bg-card p-4 hover:border-primary/40"
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
