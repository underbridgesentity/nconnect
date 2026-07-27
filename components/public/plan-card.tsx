import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { MoneyText } from "@/components/shared/money-text";
import type { PlanWithProvider } from "@/lib/domain/catalogue";

/**
 * Public plan card. Server component, no JS required.
 *
 * This is the only plan card on the site: the home page renders it too, so
 * the featured accent rule means the same thing everywhere and the journey
 * from home to category to detail stays one product.
 */
export function PlanCard({
  plan,
  headingLevel = "h3",
}: {
  plan: PlanWithProvider;
  /** Kept in step with the surrounding outline: h4 under a provider group. */
  headingLevel?: "h3" | "h4";
}) {
  const Heading = headingLevel;
  return (
    <Link
      href={`/plans/${plan.slug}`}
      className="card-hover group relative flex h-full flex-col overflow-hidden rounded-3xl border bg-card p-6"
    >
      {plan.featured ? (
        <span
          className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary to-sky-400"
          aria-hidden
        />
      ) : null}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {plan.provider.name}
          </p>
          <Heading className="mt-0.5 font-semibold">{plan.name}</Heading>
        </div>
        {plan.featured ? (
          <span className="shrink-0 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground">
            Popular
          </span>
        ) : null}
      </div>
      <div className="mt-4">
        <MoneyText
          cents={plan.priceCents}
          whole
          className="text-3xl font-semibold"
        />
        <span className="text-sm text-muted-foreground"> /month</span>
      </div>
      {plan.speedDownMbps ? (
        <p className="mt-1.5 text-sm font-medium">
          {plan.speedDownMbps}
          {plan.speedUpMbps ? `/${plan.speedUpMbps}` : ""} Mbps
        </p>
      ) : null}
      {plan.dataAllocation ? (
        <p className="mt-1 text-sm text-muted-foreground">
          {plan.dataAllocation}
        </p>
      ) : null}
      {plan.onceOffCents > 0 ? (
        <p className="mt-1.5 text-xs text-muted-foreground">
          Once-off: <MoneyText cents={plan.onceOffCents} whole />
        </p>
      ) : null}
      <div className="mt-5 flex flex-1 items-end">
        <span className="inline-flex touch-target items-center gap-1.5 text-sm font-semibold text-primary">
          View details
          <ArrowRight
            className="size-3.5 transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        </span>
      </div>
    </Link>
  );
}
