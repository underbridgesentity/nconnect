import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { MoneyText } from "@/components/shared/money-text";
import type { PlanWithProvider } from "@/lib/domain/catalogue";

/** Public plan card — server component, no JS required. */
export function PlanCard({ plan }: { plan: PlanWithProvider }) {
  return (
    <div className="flex flex-col rounded-lg border bg-card p-5 transition-shadow hover:shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{plan.name}</h3>
          <p className="text-xs text-muted-foreground">{plan.provider.name}</p>
        </div>
        {plan.featured ? (
          <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
            Popular
          </span>
        ) : null}
      </div>
      <div className="mt-3">
        <MoneyText cents={plan.priceCents} whole className="text-2xl font-semibold" />
        <span className="text-sm text-muted-foreground"> /month</span>
      </div>
      {plan.speedDownMbps ? (
        <p className="mt-1 text-sm text-muted-foreground">
          {plan.speedDownMbps}
          {plan.speedUpMbps ? `/${plan.speedUpMbps}` : ""} Mbps
        </p>
      ) : null}
      {plan.dataAllocation ? (
        <p className="mt-1 text-sm">{plan.dataAllocation}</p>
      ) : null}
      {plan.onceOffCents > 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Once-off: <MoneyText cents={plan.onceOffCents} whole />
        </p>
      ) : null}
      <div className="mt-4 flex flex-1 items-end">
        <Link
          href={`/plans/${plan.slug}`}
          className="inline-flex touch-target items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          View details <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>
    </div>
  );
}
