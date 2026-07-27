import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import {
  Wifi,
  Cable,
  PhoneCall,
  Smartphone,
  LifeBuoy,
  ShoppingBag,
  CheckCircle2,
} from "lucide-react";
import { db } from "@/lib/db/client";
import { invoices, plans, provisioningTasks } from "@/lib/db/schema";
import { currentActor } from "@/lib/auth";
import { customerServices, todayInJohannesburg } from "@/lib/domain/services";
import {
  payLinkFor,
  DEFAULT_DUNNING,
  type DunningConfig,
} from "@/lib/domain/billing-engine";
import { getSettingOr } from "@/lib/domain/settings";
import { formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { MoneyText } from "@/components/shared/money-text";
import { StatusPill } from "@/components/shared/status-pill";
import { EmptyState } from "@/components/shared/empty-state";
import { paidCentsByInvoice, withBalance } from "./_lib/balances";
import { outstandingLine } from "./_lib/invoice-copy";

export const metadata: Metadata = { title: "My services" };

const CATEGORY_ICONS = {
  lte_home: Wifi,
  telkom_lte: Wifi,
  fibre: Cable,
  voip: PhoneCall,
  sim_data: Smartphone,
} as const;

/** Live first, in a stable order, so the list never shuffles between visits. */
const STATUS_ORDER: Record<string, number> = {
  suspended: 0,
  provisioning: 1,
  pending: 2,
  active: 3,
  pending_cancellation: 4,
  cancelled: 5,
};

export default async function PortalHomePage() {
  const actor = await currentActor();
  if (!actor?.customerId) redirect("/login");
  const customerId = actor.customerId;

  const [rows, openInvoices, paidByInvoice, dunning] = await Promise.all([
    customerServices(customerId),
    db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.customerId, customerId),
          inArray(invoices.status, ["open", "past_due"])
        )
      ),
    paidCentsByInvoice(customerId),
    getSettingOr<DunningConfig>("dunning", DEFAULT_DUNNING),
  ]);

  // Money owed is invoice total minus completed payments: part-payments are
  // real, and charging the full amount again is not an option we offer.
  const balances = openInvoices
    .map((invoice) => withBalance(invoice, paidByInvoice.get(invoice.id)))
    .filter((row) => row.balanceCents > 0)
    .sort((a, b) => a.invoice.dueDate.localeCompare(b.invoice.dueDate));
  const dueCents = balances.reduce((sum, row) => sum + row.balanceCents, 0);
  const oldest = balances[0];

  const live = rows
    .filter(({ service }) => service.status !== "cancelled")
    .sort(
      (a, b) =>
        (STATUS_ORDER[a.service.status] ?? 9) -
          (STATUS_ORDER[b.service.status] ?? 9) ||
        b.service.createdAt.getTime() - a.service.createdAt.getTime()
    );
  const past = rows
    .filter(({ service }) => service.status === "cancelled")
    .sort((a, b) => b.service.createdAt.getTime() - a.service.createdAt.getTime());

  // Scheduled plan changes and activation progress, both read straight from
  // the columns that already drive them, so the screen cannot drift.
  const pendingPlanIds = live
    .map(({ service }) => service.pendingPlanId)
    .filter((planId): planId is string => Boolean(planId));
  const inProgressIds = live
    .filter(
      ({ service }) =>
        service.status === "pending" || service.status === "provisioning"
    )
    .map(({ service }) => service.id);

  const [pendingPlans, tasks] = await Promise.all([
    pendingPlanIds.length
      ? db.select().from(plans).where(inArray(plans.id, pendingPlanIds))
      : [],
    inProgressIds.length
      ? db
          .select({
            serviceId: provisioningTasks.serviceId,
            checklist: provisioningTasks.checklist,
          })
          .from(provisioningTasks)
          .where(
            and(
              inArray(provisioningTasks.serviceId, inProgressIds),
              eq(provisioningTasks.type, "activate"),
              inArray(provisioningTasks.status, [
                "open",
                "in_progress",
                "blocked",
              ])
            )
          )
      : [],
  ]);
  const planById = new Map(pendingPlans.map((p) => [p.id, p]));
  const progressByService = new Map(
    tasks
      .filter((t) => t.serviceId)
      .map((t) => [
        t.serviceId as string,
        {
          done: t.checklist.filter((step) => step.done).length,
          total: t.checklist.length,
        },
      ])
  );

  const today = todayInJohannesburg();

  // The calm all-clear only makes sense when something really is running: a
  // service that is still being activated is not "everything's running".
  const hasRunningService = live.some(
    ({ service }) =>
      service.status === "active" || service.status === "pending_cancellation"
  );

  // The next charge: soonest billing date across active services, priced on
  // the plan that will actually be in force on that date.
  const billing = live.filter(
    ({ service }) => service.status === "active" && service.nextInvoiceDate
  );
  const nextDate = billing
    .map(({ service }) => service.nextInvoiceDate!)
    .sort((a, b) => a.localeCompare(b))[0];
  const nextTotalCents = billing
    .filter(({ service }) => service.nextInvoiceDate === nextDate)
    .reduce((sum, { service, plan }) => {
      const scheduled =
        service.pendingPlanId &&
        service.planChangeEffectiveDate &&
        service.planChangeEffectiveDate <= (nextDate ?? "")
          ? planById.get(service.pendingPlanId)
          : null;
      return sum + (scheduled?.priceCents ?? plan.priceCents);
    }, 0);

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold tracking-tight">My services</h1>

      {dueCents > 0 && oldest ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-800">
            <MoneyText cents={dueCents} /> outstanding
          </p>
          <p className="mt-1 text-xs text-red-700">
            {outstandingLine({
              number: oldest.invoice.number,
              status: oldest.invoice.status,
              issueDate: oldest.invoice.issueDate,
              dueDate: oldest.invoice.dueDate,
              hasService: Boolean(oldest.invoice.serviceId),
              suspendDay: dunning.suspendDay,
              today,
            })}
          </p>
          {oldest.partiallyPaid ? (
            <p className="mt-1 text-xs text-red-700">
              We have received <MoneyText cents={oldest.paidCents} /> of{" "}
              <MoneyText cents={oldest.invoice.totalCents} /> on this invoice
              {oldest.lastPaymentAt
                ? `, last payment ${formatDate(oldest.lastPaymentAt)}`
                : ""}
              . Pay the remaining <MoneyText cents={oldest.balanceCents} /> by
              EFT using reference {oldest.invoice.number}, or ask us in Help for
              a link for the balance.
            </p>
          ) : null}
          <div className="mt-3 flex flex-col gap-2">
            {oldest.partiallyPaid ? (
              <Button
                variant="outline"
                className="w-full touch-target"
                render={<Link href="/portal/help" />}
              >
                Ask about this balance
              </Button>
            ) : (
              <a
                href={payLinkFor(oldest.invoice.id)}
                className="flex touch-target items-center justify-center rounded-full bg-red-600 px-5 text-sm font-medium text-white transition-colors hover:bg-red-700"
              >
                Pay <MoneyText cents={oldest.balanceCents} /> now
              </a>
            )}
            <Link
              href="/portal/billing"
              className="flex touch-target items-center justify-center text-xs font-medium text-red-800 underline-offset-4 hover:underline"
            >
              See all invoices
            </Link>
          </div>
        </div>
      ) : hasRunningService ? (
        <p className="flex items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Everything&apos;s running, nothing outstanding.
            {nextDate ? (
              <>
                {" "}
                Next invoice <MoneyText cents={nextTotalCents} whole /> on{" "}
                {formatDate(nextDate)}.
              </>
            ) : null}
          </span>
        </p>
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
          {live.map(({ service, plan }) => {
            const Icon =
              CATEGORY_ICONS[plan.category as keyof typeof CATEGORY_ICONS] ??
              Wifi;
            const pending = service.pendingPlanId
              ? planById.get(service.pendingPlanId)
              : null;
            const progress = progressByService.get(service.id);
            return (
              <Link
                key={service.id}
                href={`/portal/services/${service.id}`}
                className="block rounded-2xl border bg-card p-4 hover:border-primary/40"
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
                {service.status === "provisioning" ||
                service.status === "pending" ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {progress && progress.total > 0
                      ? `Being activated, ${progress.done} of ${progress.total} steps done. We'll WhatsApp you the moment it's live.`
                      : "Being activated, we'll WhatsApp you the moment it's live."}
                  </p>
                ) : service.status === "suspended" ? (
                  <p className="mt-2 text-sm text-amber-700">
                    Suspended for non-payment. Settle the outstanding invoice
                    above and it reactivates automatically.
                  </p>
                ) : service.status === "pending_cancellation" ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Cancels on {formatDate(service.cancelEffectiveDate)}, active
                    until then. Changed your mind? Open the service to withdraw.
                  </p>
                ) : service.nextInvoiceDate ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Next invoice {formatDate(service.nextInvoiceDate)} ·{" "}
                    <MoneyText cents={plan.priceCents} whole />
                  </p>
                ) : null}
                {pending ? (
                  <p className="mt-1 text-sm text-blue-800">
                    Changing to {pending.name} on{" "}
                    {formatDate(service.planChangeEffectiveDate)}, then{" "}
                    <MoneyText cents={pending.priceCents} whole />
                    /month.
                  </p>
                ) : null}
              </Link>
            );
          })}
        </div>
      )}

      {past.length > 0 ? (
        <details className="rounded-2xl border bg-card">
          <summary className="flex touch-target cursor-pointer items-center px-4 text-sm font-medium">
            Past services ({past.length})
          </summary>
          <ul className="border-t px-4 py-3 text-sm">
            {past.map(({ service, plan }) => (
              <li
                key={service.id}
                className="flex items-center justify-between gap-2 py-1"
              >
                <Link
                  href={`/portal/services/${service.id}`}
                  className="text-muted-foreground hover:text-foreground"
                >
                  {plan.name}
                </Link>
                <span className="text-xs text-muted-foreground">
                  ended {formatDate(service.cancelEffectiveDate)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {rows.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            className="w-full touch-target"
            render={<Link href="/portal/help" />}
          >
            <LifeBuoy className="size-4" aria-hidden />
            Get help
          </Button>
          <Button
            variant="ghost"
            className="w-full touch-target"
            render={<Link href="/internet" />}
          >
            <ShoppingBag className="size-4" aria-hidden />
            Browse plans
          </Button>
        </div>
      ) : null}
    </div>
  );
}
