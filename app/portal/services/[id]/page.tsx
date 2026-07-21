import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { CheckCircle2 } from "lucide-react";
import { db } from "@/lib/db/client";
import {
  services,
  plans,
  providers,
  addresses,
  orderItems,
  hardwareProducts,
} from "@/lib/db/schema";
import { currentActor } from "@/lib/auth";
import { MoneyText } from "@/components/shared/money-text";
import { StatusPill } from "@/components/shared/status-pill";
import { withdrawCancellationAction } from "./actions";

export const metadata: Metadata = { title: "Service" };

export default async function PortalServicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    changed?: string;
    date?: string;
    cancelled?: string;
    withdrawn?: string;
    invoice?: string;
  }>;
}) {
  const { id } = await params;
  const flags = await searchParams;
  const actor = await currentActor();
  if (!actor?.customerId) redirect("/login");

  const [row] = await db
    .select({ service: services, plan: plans, provider: providers })
    .from(services)
    .innerJoin(plans, eq(services.planId, plans.id))
    .innerJoin(providers, eq(plans.providerId, providers.id))
    .where(eq(services.id, id))
    .limit(1);
  if (!row || row.service.customerId !== actor.customerId) notFound();
  const { service, plan, provider } = row;

  const [address] = service.addressId
    ? await db
        .select()
        .from(addresses)
        .where(eq(addresses.id, service.addressId))
        .limit(1)
    : [];

  // Hardware bought on the same order (spec §9.3: linked hardware).
  const hardware = service.originOrderId
    ? await db
        .select({ item: orderItems, product: hardwareProducts })
        .from(orderItems)
        .innerJoin(
          hardwareProducts,
          eq(orderItems.hardwareId, hardwareProducts.id)
        )
        .where(eq(orderItems.orderId, service.originOrderId))
    : [];

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/portal"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← My services
        </Link>
        <div className="mt-1 flex items-start justify-between gap-2">
          <h1 className="text-xl font-semibold tracking-tight">{plan.name}</h1>
          <StatusPill status={service.status} />
        </div>
        <p className="text-sm text-muted-foreground">{provider.name}</p>
      </div>

      {flags.changed === "upgrade" ? (
        <p className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <CheckCircle2 className="size-4 shrink-0" aria-hidden />
          Upgrade done, it&apos;s live now.{" "}
          {flags.invoice
            ? "The pro-rata adjustment invoice is in your Billing tab."
            : "The pro-rata adjustment was charged to your saved card."}
        </p>
      ) : null}
      {flags.changed === "downgrade" ? (
        <p className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
          Downgrade scheduled for {flags.date}. You keep your current plan
          until then, no partial charges.
        </p>
      ) : null}
      {flags.cancelled ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Cancellation confirmed for {flags.cancelled}. The service stays
          active until then, and you can withdraw below any time before that
          date.
        </p>
      ) : null}
      {flags.withdrawn ? (
        <p className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <CheckCircle2 className="size-4 shrink-0" aria-hidden />
          Cancellation withdrawn, nothing changes, welcome back.
        </p>
      ) : null}

      <section className="rounded-lg border bg-card p-4">
        <h2 className="text-sm font-semibold">Plan & pricing</h2>
        <p className="mt-2">
          <MoneyText cents={plan.priceCents} whole className="text-2xl font-semibold" />
          <span className="text-sm text-muted-foreground"> /month</span>
        </p>
        {service.nextInvoiceDate ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Next invoice {service.nextInvoiceDate}
          </p>
        ) : null}
        {plan.dataAllocation ? (
          <p className="mt-3 text-sm">{plan.dataAllocation}</p>
        ) : null}
        {plan.fupDetail ? (
          <p className="mt-1 text-sm text-muted-foreground">{plan.fupDetail}</p>
        ) : null}
      </section>

      {address ? (
        <section className="rounded-lg border bg-card p-4">
          <h2 className="text-sm font-semibold">Install address</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {[address.line1, address.line2, address.suburb, address.city, address.postalCode]
              .filter(Boolean)
              .join(", ")}
          </p>
        </section>
      ) : null}

      {hardware.length > 0 ? (
        <section className="rounded-lg border bg-card p-4">
          <h2 className="text-sm font-semibold">Your hardware</h2>
          <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
            {hardware.map(({ item, product }) => (
              <li key={item.id}>
                {product.name}
                {item.qty > 1 ? ` × ${item.qty}` : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {service.status === "active" ? (
        <div className="flex flex-col gap-2">
          <Link
            href={`/portal/services/${id}/change`}
            className="flex touch-target items-center justify-center rounded-md border px-5 text-sm font-medium hover:bg-accent"
          >
            Change plan
          </Link>
          <Link
            href={`/portal/services/${id}/cancel`}
            className="flex touch-target items-center justify-center rounded-md px-5 text-sm text-muted-foreground hover:text-destructive"
          >
            Cancel this service
          </Link>
        </div>
      ) : null}

      {service.status === "pending_cancellation" ? (
        <form action={withdrawCancellationAction}>
          <input type="hidden" name="serviceId" value={id} />
          <button
            type="submit"
            className="flex w-full touch-target items-center justify-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Withdraw cancellation, keep my service
          </button>
        </form>
      ) : null}
    </div>
  );
}
