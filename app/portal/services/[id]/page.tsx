import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Circle,
  LifeBuoy,
} from "lucide-react";
import { db } from "@/lib/db/client";
import {
  services,
  plans,
  providers,
  addresses,
  orderItems,
  hardwareProducts,
  provisioningTasks,
  providerAccounts,
  sims,
  ricaRecords,
} from "@/lib/db/schema";
import { currentActor } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { MoneyText } from "@/components/shared/money-text";
import { StatusPill } from "@/components/shared/status-pill";
import { isUuid } from "@/app/portal/_lib/uuid";
import { customerStepLabel } from "@/app/portal/_lib/progress";
import {
  WithdrawCancellationButton,
  CancelScheduledChangeButton,
} from "./service-actions";
import { CopyCode } from "./copy-code";

export const metadata: Metadata = { title: "Service" };

const SIM_CATEGORIES: string[] = ["lte_home", "telkom_lte", "sim_data"];

const ORDINAL_SUFFIX = (day: number) => {
  if (day % 100 >= 11 && day % 100 <= 13) return "th";
  return ["th", "st", "nd", "rd"][day % 10] ?? "th";
};

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
    changeCancelled?: string;
  }>;
}) {
  const { id } = await params;
  const flags = await searchParams;
  if (!isUuid(id)) notFound();
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

  const inProgress =
    service.status === "pending" || service.status === "provisioning";
  // RICA only gates SIM-based products, so never raise it on a fibre or VoIP
  // service (§7: activation of a SIM service is blocked until RICA verifies).
  const needsRica = SIM_CATEGORIES.includes(plan.category);

  const [address, hardware, pendingPlanRow, openTask, account, sim, rica] =
    await Promise.all([
      service.addressId
        ? db
            .select()
            .from(addresses)
            .where(eq(addresses.id, service.addressId))
            .limit(1)
            .then((r) => r[0] ?? null)
        : null,
      // Hardware bought on the same order (spec §9.3: linked hardware).
      service.originOrderId
        ? db
            .select({ item: orderItems, product: hardwareProducts })
            .from(orderItems)
            .innerJoin(
              hardwareProducts,
              eq(orderItems.hardwareId, hardwareProducts.id)
            )
            .where(eq(orderItems.orderId, service.originOrderId))
        : [],
      service.pendingPlanId
        ? db
            .select()
            .from(plans)
            .where(eq(plans.id, service.pendingPlanId))
            .limit(1)
            .then((r) => r[0] ?? null)
        : null,
      inProgress
        ? db
            .select()
            .from(provisioningTasks)
            .where(
              and(
                eq(provisioningTasks.serviceId, id),
                eq(provisioningTasks.type, "activate"),
                inArray(provisioningTasks.status, [
                  "open",
                  "in_progress",
                  "blocked",
                ])
              )
            )
            .orderBy(desc(provisioningTasks.createdAt))
            .limit(1)
            .then((r) => r[0] ?? null)
        : null,
      service.providerAccountId
        ? db
            .select()
            .from(providerAccounts)
            .where(eq(providerAccounts.id, service.providerAccountId))
            .limit(1)
            .then((r) => r[0] ?? null)
        : null,
      service.simId
        ? db
            .select()
            .from(sims)
            .where(eq(sims.id, service.simId))
            .limit(1)
            .then((r) => r[0] ?? null)
        : null,
      // The RICA record for this service, or the customer's record that is not
      // yet linked to a service (it is captured at signup, before activation).
      needsRica
        ? db
            .select({
              status: ricaRecords.status,
              rejectionReason: ricaRecords.rejectionReason,
            })
            .from(ricaRecords)
            .where(
              or(
                eq(ricaRecords.serviceId, id),
                and(
                  eq(ricaRecords.customerId, actor.customerId),
                  isNull(ricaRecords.serviceId)
                )
              )
            )
            .orderBy(desc(ricaRecords.createdAt))
            .limit(1)
            .then((r) => r[0] ?? null)
        : null,
    ]);

  const checklist = openTask?.checklist ?? [];
  const doneCount = checklist.filter((step) => step.done).length;
  const msisdn = sim?.msisdn ?? account?.msisdn ?? null;
  const detailRows: Array<{ label: string; value: string; code?: boolean }> = [];
  if (msisdn) detailRows.push({ label: "Your number", value: msisdn, code: true });
  if (sim?.iccid)
    detailRows.push({ label: "SIM ICCID", value: sim.iccid, code: true });
  if (account?.circuitId)
    detailRows.push({
      label: "Circuit reference",
      value: account.circuitId,
      code: true,
    });
  if (account?.externalRef)
    detailRows.push({
      label: `${provider.name} account`,
      value: account.externalRef,
      code: true,
    });
  if (service.activationDate)
    detailRows.push({
      label: "Activated on",
      value: formatDate(service.activationDate),
    });
  if (service.billingAnchorDay)
    detailRows.push({
      label: "Billed on",
      value: `the ${service.billingAnchorDay}${ORDINAL_SUFFIX(service.billingAnchorDay)} of each month`,
    });

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
        <p className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <CheckCircle2 className="size-4 shrink-0" aria-hidden />
          Upgrade done, it&apos;s live now.{" "}
          {flags.invoice
            ? "The pro-rata adjustment invoice is in your Billing tab."
            : "The pro-rata adjustment was charged to your saved card."}
        </p>
      ) : null}
      {flags.changed === "downgrade" ? (
        <p className="rounded-2xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
          Downgrade scheduled for {formatDate(flags.date)}. You keep your
          current plan until then, no partial charges.
        </p>
      ) : null}
      {flags.changeCancelled ? (
        <p className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <CheckCircle2 className="size-4 shrink-0" aria-hidden />
          Scheduled change cancelled. You stay on {plan.name} at{" "}
          <MoneyText cents={plan.priceCents} whole />
          /month.
        </p>
      ) : null}
      {flags.cancelled ? (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Cancellation confirmed for {formatDate(flags.cancelled)}. The service
          stays active until then, and you can withdraw below any time before
          that date.
        </p>
      ) : null}
      {flags.withdrawn ? (
        <p className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <CheckCircle2 className="size-4 shrink-0" aria-hidden />
          Cancellation withdrawn, nothing changes, welcome back.
        </p>
      ) : null}

      {/* A RICA rejection blocks activation outright, so it comes first. */}
      {inProgress && rica?.status === "rejected" ? (
        <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-900">
            <AlertTriangle className="size-4 shrink-0" aria-hidden />
            We need better RICA documents
          </h2>
          <p className="mt-1 text-sm text-amber-900">
            RICA is a legal requirement before a SIM can go live, and the
            documents we have could not be accepted:
          </p>
          {rica.rejectionReason ? (
            <p className="mt-2 rounded-md bg-white/70 p-2 text-sm text-amber-900">
              {rica.rejectionReason}
            </p>
          ) : null}
          <p className="mt-2 text-sm text-amber-900">
            Send us a clear photo of your ID and a proof of address in a Help
            conversation and we&apos;ll re-check it and get your activation
            moving.
          </p>
          <Button
            className="mt-3 w-full touch-target"
            render={<Link href="/portal/help" />}
          >
            <LifeBuoy className="size-4" aria-hidden />
            Send new documents
          </Button>
        </section>
      ) : inProgress ? (
        <section className="rounded-2xl border bg-card p-4">
          <h2 className="text-sm font-semibold">Getting you connected</h2>
          {checklist.length > 0 ? (
            <>
              <p className="mt-1 text-sm text-muted-foreground">
                {doneCount} of {checklist.length} steps done. We&apos;ll
                WhatsApp you the moment it&apos;s live.
              </p>
              <ul className="mt-3 space-y-2">
                {checklist.map((step, index) => (
                  <li
                    key={`${index}-${step.label}`}
                    className="flex items-start gap-2 text-sm"
                  >
                    {step.done ? (
                      <CheckCircle2
                        className="mt-0.5 size-4 shrink-0 text-emerald-600"
                        aria-hidden
                      />
                    ) : (
                      <Circle
                        className="mt-0.5 size-4 shrink-0 text-muted-foreground/50"
                        aria-hidden
                      />
                    )}
                    <span
                      className={
                        step.done ? "text-muted-foreground" : "text-foreground"
                      }
                    >
                      {customerStepLabel(step.label)}
                      <span className="sr-only">
                        {step.done ? ", done" : ", still to do"}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              We&apos;re setting this up with {provider.name} now, and
              we&apos;ll WhatsApp you the moment it&apos;s live.
            </p>
          )}
          {rica?.status === "pending" ? (
            <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">
              Your RICA documents are with us for checking. Nothing needed from
              you unless we come back to you.
            </p>
          ) : null}
        </section>
      ) : null}

      {pendingPlanRow ? (
        <section className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-blue-900">
            <CalendarClock className="size-4 shrink-0" aria-hidden />
            Plan change scheduled
          </h2>
          <p className="mt-1 text-sm text-blue-900">
            You move to{" "}
            <span className="font-medium">{pendingPlanRow.name}</span> on{" "}
            <span className="font-medium">
              {formatDate(service.planChangeEffectiveDate)}
            </span>
            , and pay <MoneyText cents={pendingPlanRow.priceCents} whole />
            /month from then. Until that date nothing changes.
          </p>
          <CancelScheduledChangeButton serviceId={id} />
        </section>
      ) : null}

      <section className="rounded-2xl border bg-card p-4">
        <h2 className="text-sm font-semibold">Plan &amp; pricing</h2>
        <p className="mt-2">
          <MoneyText
            cents={plan.priceCents}
            whole
            className="text-2xl font-semibold"
          />
          <span className="text-sm text-muted-foreground"> /month</span>
        </p>
        {service.nextInvoiceDate ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Next invoice {formatDate(service.nextInvoiceDate)}
          </p>
        ) : null}
        {plan.dataAllocation ? (
          <p className="mt-3 text-sm">{plan.dataAllocation}</p>
        ) : null}
        {plan.fupDetail ? (
          <p className="mt-1 text-sm text-muted-foreground">{plan.fupDetail}</p>
        ) : null}
      </section>

      {detailRows.length > 0 ? (
        <section className="rounded-2xl border bg-card p-4">
          <h2 className="text-sm font-semibold">Service details</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            The details a technician or a device setup screen asks for.
          </p>
          <dl className="mt-3 space-y-2 text-sm">
            {detailRows.map((detail) => (
              <div
                key={detail.label}
                className="flex items-center justify-between gap-3"
              >
                <dt className="text-muted-foreground">{detail.label}</dt>
                <dd className="text-right">
                  {detail.code ? (
                    <CopyCode value={detail.value} label={detail.label} />
                  ) : (
                    detail.value
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {address ? (
        <section className="rounded-2xl border bg-card p-4">
          <h2 className="text-sm font-semibold">Install address</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {[
              address.line1,
              address.line2,
              address.suburb,
              address.city,
              address.postalCode,
            ]
              .filter(Boolean)
              .join(", ")}
          </p>
        </section>
      ) : null}

      {hardware.length > 0 ? (
        <section className="rounded-2xl border bg-card p-4">
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
          <Button
            variant="outline"
            className="w-full touch-target"
            render={<Link href={`/portal/services/${id}/change`} />}
          >
            Change plan
          </Button>
          <Button
            variant="ghost"
            className="w-full touch-target text-muted-foreground hover:text-destructive"
            render={<Link href={`/portal/services/${id}/cancel`} />}
          >
            Cancel this service
          </Button>
        </div>
      ) : null}

      {service.status === "pending_cancellation" ? (
        <WithdrawCancellationButton serviceId={id} />
      ) : null}
    </div>
  );
}
