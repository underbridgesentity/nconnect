import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, eq, lt } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { services, plans } from "@/lib/db/schema";
import { currentActor } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { MoneyText } from "@/components/shared/money-text";
import { isUuid } from "@/app/portal/_lib/uuid";
import { ConfirmCancellation } from "./confirm-form";

export const metadata: Metadata = { title: "Cancel service" };

/**
 * Cancellation with retention (spec §9.3): one honest screen offering a
 * downgrade or a conversation, then confirm with the effective date. No
 * retention marathon.
 */
export default async function CancelServicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ confirm?: string }>;
}) {
  const { id } = await params;
  const { confirm } = await searchParams;
  if (!isUuid(id)) notFound();
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

  const effectiveDateLabel = service.nextInvoiceDate
    ? formatDate(service.nextInvoiceDate)
    : "the end of your billing period";

  if (confirm === "1") {
    return (
      <div className="space-y-5">
        <h1 className="text-xl font-semibold tracking-tight">
          Confirm cancellation
        </h1>
        <div className="rounded-2xl border bg-card p-4 text-sm">
          <p>
            <span className="font-medium">{plan.name}</span> will cancel on{" "}
            <span className="font-medium">{effectiveDateLabel}</span>.
          </p>
          <ul className="mt-2 space-y-1 text-muted-foreground">
            <li>
              • It stays fully active until that date, you&apos;ve paid for it.
            </li>
            <li>• No further invoices after that.</li>
            <li>• You can withdraw the cancellation any time before then.</li>
          </ul>
        </div>
        <ConfirmCancellation
          serviceId={id}
          effectiveDateLabel={effectiveDateLabel}
        />
      </div>
    );
  }

  const cheaper = await db
    .select()
    .from(plans)
    .where(
      and(
        eq(plans.category, plan.category),
        eq(plans.status, "published"),
        lt(plans.priceCents, plan.priceCents)
      )
    );

  return (
    <div className="space-y-5">
      <Link
        href={`/portal/services/${id}`}
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        ← Back to service
      </Link>
      <h1 className="text-xl font-semibold tracking-tight">
        Before you cancel…
      </h1>
      <p className="text-sm text-muted-foreground">
        One screen, we promise. Two things that fix the most common reasons
        people cancel:
      </p>

      {cheaper.length > 0 ? (
        <div className="rounded-2xl border bg-card p-4">
          <h2 className="text-sm font-semibold">Paying too much?</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Drop to a cheaper plan instead, from{" "}
            <MoneyText
              cents={Math.min(...cheaper.map((p) => p.priceCents))}
              whole
            />
            /month, effective at your next billing date.
          </p>
          <Button
            variant="outline"
            className="mt-3 w-full touch-target"
            render={<Link href={`/portal/services/${id}/change`} />}
          >
            See cheaper plans
          </Button>
        </div>
      ) : null}

      <div className="rounded-2xl border bg-card p-4">
        <h2 className="text-sm font-semibold">Something not working?</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Slow evenings, drops, billing confusion, most issues are fixable in
          one conversation with someone who knows your setup.
        </p>
        <Button
          variant="outline"
          className="mt-3 w-full touch-target"
          render={<Link href="/portal/help" />}
        >
          Talk to us first
        </Button>
      </div>

      <Link
        href={`/portal/services/${id}/cancel?confirm=1`}
        className="flex touch-target items-center justify-center rounded-full px-5 text-sm font-medium text-destructive hover:underline"
      >
        No thanks, continue to cancel
      </Link>
    </div>
  );
}
