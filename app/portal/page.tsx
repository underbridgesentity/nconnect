import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { Wifi, Cable, PhoneCall, Smartphone } from "lucide-react";
import { db } from "@/lib/db/client";
import { invoices } from "@/lib/db/schema";
import { currentActor } from "@/lib/auth";
import { customerServices } from "@/lib/domain/services";
import { payLinkFor } from "@/lib/domain/billing-engine";
import { MoneyText } from "@/components/shared/money-text";
import { StatusPill } from "@/components/shared/status-pill";
import { EmptyState } from "@/components/shared/empty-state";

export const metadata: Metadata = { title: "My services" };

const CATEGORY_ICONS = {
  lte_home: Wifi,
  telkom_lte: Wifi,
  fibre: Cable,
  voip: PhoneCall,
  sim_data: Smartphone,
} as const;

export default async function PortalHomePage() {
  const actor = await currentActor();
  if (!actor?.customerId) redirect("/login");

  const [rows, openInvoices] = await Promise.all([
    customerServices(actor.customerId),
    db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.customerId, actor.customerId),
          inArray(invoices.status, ["open", "past_due"])
        )
      ),
  ]);

  const dueCents = openInvoices.reduce((sum, i) => sum + i.totalCents, 0);
  const oldestDue = openInvoices.sort((a, b) =>
    a.dueDate.localeCompare(b.dueDate)
  )[0];

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold tracking-tight">My services</h1>

      {dueCents > 0 && oldestDue ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-800">
            <MoneyText cents={dueCents} /> outstanding
          </p>
          <p className="mt-0.5 text-xs text-red-700/80">
            Settle it to keep everything running smoothly.
          </p>
          <a
            href={payLinkFor(oldestDue.id)}
            className="mt-3 flex touch-target items-center justify-center rounded-md bg-red-600 px-5 text-sm font-medium text-white hover:bg-red-700"
          >
            Pay now
          </a>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          icon={Wifi}
          sentence="You don't have any services yet. When you sign up for a plan it will appear here, with its status and next invoice."
          action={
            <Link
              href="/internet"
              className="text-sm font-medium text-primary hover:underline"
            >
              Browse plans
            </Link>
          }
        />
      ) : (
        <div className="space-y-3">
          {rows.map(({ service, plan }) => {
            const Icon =
              CATEGORY_ICONS[plan.category as keyof typeof CATEGORY_ICONS] ??
              Wifi;
            return (
              <Link
                key={service.id}
                href={`/portal/services/${service.id}`}
                className="block rounded-lg border bg-card p-4 hover:border-primary/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="flex items-center gap-2.5">
                    <Icon className="size-5 text-primary" aria-hidden />
                    <span>
                      <span className="block font-medium">{plan.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        <MoneyText cents={plan.priceCents} whole />
                        /month
                      </span>
                    </span>
                  </span>
                  <StatusPill status={service.status} />
                </div>
                {service.status === "provisioning" ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Being activated, we&apos;ll WhatsApp you the moment
                    it&apos;s live.
                  </p>
                ) : service.status === "suspended" ? (
                  <p className="mt-2 text-sm text-amber-700">
                    Suspended for non-payment. Settle the outstanding invoice
                    above and it reactivates automatically.
                  </p>
                ) : service.status === "pending_cancellation" ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Cancels on {service.cancelEffectiveDate}, active until
                    then. Changed your mind? Open the service to withdraw.
                  </p>
                ) : service.nextInvoiceDate ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Next invoice {service.nextInvoiceDate} ·{" "}
                    <MoneyText cents={plan.priceCents} whole />
                  </p>
                ) : null}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
