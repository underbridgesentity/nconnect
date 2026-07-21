import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { services, plans } from "@/lib/db/schema";
import { currentActor } from "@/lib/auth";
import {
  computeUpgradeAdjustment,
} from "@/lib/domain/billing-engine";
import { todayInJohannesburg, nextMonthOnAnchor } from "@/lib/domain/services";
import { MoneyText } from "@/components/shared/money-text";
import { changePlanAction } from "../actions";

export const metadata: Metadata = { title: "Change plan" };

/**
 * Plan change (spec §9.3): upgrades apply immediately with a clear pro-rata
 * summary before confirming; downgrades take effect at the next cycle,
 * stated plainly. Same-category plans only.
 */
export default async function ChangePlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ to?: string }>;
}) {
  const { id } = await params;
  const { to } = await searchParams;
  const actor = await currentActor();
  if (!actor?.customerId) redirect("/login");

  const [row] = await db
    .select({ service: services, plan: plans })
    .from(services)
    .innerJoin(plans, eq(services.planId, plans.id))
    .where(eq(services.id, id))
    .limit(1);
  if (!row || row.service.customerId !== actor.customerId) notFound();
  const { service, plan } = row;
  if (service.status !== "active") redirect(`/portal/services/${id}`);

  const options = (
    await db
      .select()
      .from(plans)
      .where(
        and(eq(plans.category, plan.category), eq(plans.status, "published"))
      )
  ).filter((p) => p.id !== plan.id);

  const chosen = to ? options.find((p) => p.slug === to) : null;

  if (chosen) {
    const isUpgrade = chosen.priceCents >= plan.priceCents;
    const today = todayInJohannesburg();
    const periodEnd =
      service.nextInvoiceDate ??
      nextMonthOnAnchor(today, service.billingAnchorDay ?? 1);

    let adjustment = null;
    if (isUpgrade) {
      // Same maths the engine will apply, shown before the customer confirms.
      const [py, pm] = periodEnd.split("-").map(Number);
      const prevMonth = pm === 1 ? 12 : pm - 1;
      const prevYear = pm === 1 ? py - 1 : py;
      const periodStart = `${prevYear}-${String(prevMonth).padStart(2, "0")}-${String(
        Math.min(service.billingAnchorDay ?? 1, 28)
      ).padStart(2, "0")}`;
      adjustment = computeUpgradeAdjustment(
        plan.priceCents,
        chosen.priceCents,
        periodStart,
        periodEnd,
        today
      );
    }

    return (
      <div className="space-y-5">
        <Link
          href={`/portal/services/${id}/change`}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← Choose a different plan
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">
          {isUpgrade ? "Confirm your upgrade" : "Confirm your downgrade"}
        </h1>

        <div className="rounded-lg border bg-card p-4 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Current plan</span>
            <span>
              {plan.name}, <MoneyText cents={plan.priceCents} whole />
              /mo
            </span>
          </div>
          <div className="mt-1 flex justify-between font-medium">
            <span className="text-muted-foreground">New plan</span>
            <span>
              {chosen.name}, <MoneyText cents={chosen.priceCents} whole />
              /mo
            </span>
          </div>
        </div>

        {isUpgrade && adjustment ? (
          <div className="rounded-lg border bg-card p-4 text-sm">
            <h2 className="font-semibold">What you pay now</h2>
            <p className="mt-1 text-muted-foreground">
              The upgrade is live immediately. For the {adjustment.daysRemaining}{" "}
              days left in your current period (to {periodEnd}):
            </p>
            <div className="mt-2 space-y-1">
              <div className="flex justify-between">
                <span>Credit: unused days of {plan.name}</span>
                <MoneyText cents={adjustment.creditCents} />
              </div>
              <div className="flex justify-between">
                <span>Charge: {chosen.name} for those days</span>
                <MoneyText cents={adjustment.chargeCents} />
              </div>
              <div className="flex justify-between border-t pt-1 font-semibold">
                <span>Due now</span>
                <MoneyText cents={adjustment.netCents} />
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Charged to your saved card if you have one; otherwise we send a
              pay link. From {periodEnd} you pay{" "}
              <MoneyText cents={chosen.priceCents} whole />
              /month.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border bg-card p-4 text-sm">
            <h2 className="font-semibold">When it happens</h2>
            <p className="mt-1 text-muted-foreground">
              Your downgrade takes effect on{" "}
              <span className="font-medium text-foreground">{periodEnd}</span>{" "}
             , the start of your next billing cycle. Until then you keep{" "}
              {plan.name} exactly as it is, with no partial charges. From that
              date you pay <MoneyText cents={chosen.priceCents} whole />
              /month.
            </p>
          </div>
        )}

        <form action={changePlanAction}>
          <input type="hidden" name="serviceId" value={id} />
          <input type="hidden" name="newPlanId" value={chosen.id} />
          <button
            type="submit"
            className="flex w-full touch-target items-center justify-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            {isUpgrade
              ? adjustment && adjustment.netCents > 0
                ? "Confirm upgrade"
                : "Confirm upgrade (nothing due now)"
              : "Confirm downgrade"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Link
        href={`/portal/services/${id}`}
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        ← Back to service
      </Link>
      <h1 className="text-xl font-semibold tracking-tight">Change plan</h1>
      <p className="text-sm text-muted-foreground">
        Upgrades apply immediately with a fair pro-rata adjustment. Downgrades
        start at your next billing date.
      </p>
      {options.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          There&apos;s no other published plan in this category right now.
        </p>
      ) : (
        <div className="space-y-2">
          {options.map((p) => (
            <Link
              key={p.id}
              href={`/portal/services/${id}/change?to=${p.slug}`}
              className="flex touch-target items-center justify-between rounded-lg border bg-card p-4 hover:border-primary/40"
            >
              <span>
                <span className="block font-medium">{p.name}</span>
                {p.dataAllocation ? (
                  <span className="block text-xs text-muted-foreground">
                    {p.dataAllocation}
                  </span>
                ) : null}
              </span>
              <span className="text-right">
                <MoneyText cents={p.priceCents} whole className="font-semibold" />
                <span className="block text-xs text-muted-foreground">
                  {p.priceCents >= plan.priceCents ? "upgrade" : "downgrade"}
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
