import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, eq, lt } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { services, plans } from "@/lib/db/schema";
import { currentActor } from "@/lib/auth";
import { MoneyText } from "@/components/shared/money-text";
import { cancelServiceAction } from "../actions";

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

  const effectiveDate = service.nextInvoiceDate ?? "the end of your billing period";

  if (confirm === "1") {
    return (
      <div className="space-y-5">
        <h1 className="text-xl font-semibold tracking-tight">
          Confirm cancellation
        </h1>
        <div className="rounded-lg border bg-card p-4 text-sm">
          <p>
            <span className="font-medium">{plan.name}</span> will cancel on{" "}
            <span className="font-medium">{effectiveDate}</span>.
          </p>
          <ul className="mt-2 space-y-1 text-muted-foreground">
            <li>• It stays fully active until that date, you&apos;ve paid for it.</li>
            <li>• No further invoices after that.</li>
            <li>• You can withdraw the cancellation any time before then.</li>
          </ul>
        </div>
        <form action={cancelServiceAction} className="space-y-3">
          <input type="hidden" name="serviceId" value={id} />
          <label className="block text-sm">
            <span className="text-muted-foreground">
              Mind telling us why? (helps us fix things, optional)
            </span>
            <textarea
              name="reason"
              rows={2}
              className="mt-1 w-full rounded-md border bg-background p-2 text-sm"
            />
          </label>
          <button
            type="submit"
            className="flex w-full touch-target items-center justify-center rounded-md bg-destructive px-5 text-sm font-medium text-white hover:bg-destructive/90"
          >
            Cancel my service on {effectiveDate}
          </button>
          <Link
            href={`/portal/services/${id}`}
            className="flex touch-target items-center justify-center text-sm text-muted-foreground hover:text-foreground"
          >
            Never mind, keep my service
          </Link>
        </form>
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
        <div className="rounded-lg border bg-card p-4">
          <h2 className="text-sm font-semibold">Paying too much?</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Drop to a cheaper plan instead, from{" "}
            <MoneyText
              cents={Math.min(...cheaper.map((p) => p.priceCents))}
              whole
            />
            /month, effective at your next billing date.
          </p>
          <Link
            href={`/portal/services/${id}/change`}
            className="mt-3 flex touch-target items-center justify-center rounded-md border px-5 text-sm font-medium hover:bg-accent"
          >
            See cheaper plans
          </Link>
        </div>
      ) : null}

      <div className="rounded-lg border bg-card p-4">
        <h2 className="text-sm font-semibold">Something not working?</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Slow evenings, drops, billing confusion, most issues are fixable in
          one conversation with someone who knows your setup.
        </p>
        <Link
          href="/portal/help"
          className="mt-3 flex touch-target items-center justify-center rounded-md border px-5 text-sm font-medium hover:bg-accent"
        >
          Talk to us first
        </Link>
      </div>

      <Link
        href={`/portal/services/${id}/cancel?confirm=1`}
        className="flex touch-target items-center justify-center rounded-md px-5 text-sm font-medium text-destructive hover:underline"
      >
        No thanks, continue to cancel
      </Link>
    </div>
  );
}
