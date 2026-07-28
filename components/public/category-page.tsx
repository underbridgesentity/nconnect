import Link from "next/link";
import { publishedPlans, type PlanWithProvider } from "@/lib/domain/catalogue";
import { PlanCard } from "@/components/public/plan-card";
import { PillLink } from "@/components/public/pill";
import { EmptyState } from "@/components/shared/empty-state";
import { Reveal } from "@/components/shared/reveal";

/**
 * Shared category listing (spec §9.1): published plans, sortable via server-
 * driven query params so every filtered view is a crawlable URL. No JS needed.
 */

export type CategoryKey = "lte_home" | "telkom_lte" | "fibre" | "voip" | "sim_data";

/**
 * Loads the published plans for a category page. Pages call this themselves so
 * the header band can quote a real from-price, then hand the same rows to
 * CategoryPlanList rather than making the database answer twice.
 */
export async function loadCategoryPlans(
  categories: CategoryKey[]
): Promise<PlanWithProvider[]> {
  const lists = await Promise.all(categories.map((c) => publishedPlans(c)));
  return lists.flat();
}

/** Lowest published price in cents, or null when the category is empty. */
export function fromPriceCents(plans: PlanWithProvider[]): number | null {
  if (plans.length === 0) return null;
  return plans.reduce(
    (min, plan) => (plan.priceCents < min ? plan.priceCents : min),
    plans[0].priceCents
  );
}

/** Distinct provider names across a plan list, in first-seen order. */
export function providerNames(plans: PlanWithProvider[]): string[] {
  return [...new Set(plans.map((p) => p.provider.name))];
}

/**
 * The contract term shared by every plan in the list, or null when the plans
 * disagree. Derived rather than written into the page so a catalogue change
 * can never leave a stale claim in a header band.
 */
export function termLabel(plans: PlanWithProvider[]): string | null {
  if (plans.length === 0) return null;
  const terms = new Set(plans.map((p) => p.contractMonths ?? 0));
  if (terms.size !== 1) return null;
  const months = [...terms][0];
  return months === 0 ? "Month to month" : `${months}-month term`;
}

export async function CategoryPlanList({
  categories,
  basePath,
  sort,
  groupByProvider = false,
  fno,
  heading,
  plans: providedPlans,
}: {
  categories: CategoryKey[];
  basePath: string;
  sort?: string;
  groupByProvider?: boolean;
  fno?: string;
  /**
   * Names the list for the document outline. Without it the page jumps from
   * the h1 in the header band straight to the h3 on each card.
   */
  heading: string;
  plans?: PlanWithProvider[];
}) {
  let plans = providedPlans ?? (await loadCategoryPlans(categories));

  if (fno) {
    plans = plans.filter(
      (p) => p.provider.name.toLowerCase() === fno.toLowerCase()
    );
  }

  if (sort === "price") {
    plans = [...plans].sort((a, b) => a.priceCents - b.priceCents);
  } else if (sort === "price-desc") {
    plans = [...plans].sort((a, b) => b.priceCents - a.priceCents);
  } else if (sort === "speed") {
    plans = [...plans].sort(
      (a, b) => (b.speedDownMbps ?? 0) - (a.speedDownMbps ?? 0)
    );
  }

  const sortLinks = [
    { key: undefined, label: "Recommended" },
    { key: "price", label: "Price: low to high" },
    { key: "price-desc", label: "Price: high to low" },
    { key: "speed", label: "Fastest first" },
  ];

  const providers = groupByProvider
    ? [...new Set(plans.map((p) => p.provider.name))]
    : [];
  const grouped = groupByProvider && !sort && !fno;

  return (
    <div id="plans" className="scroll-mt-28">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{heading}</h2>
          {plans.length > 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {plans.length} published {plans.length === 1 ? "plan" : "plans"}
              {fno ? ` on ${fno}` : ""}, all prices per month.
            </p>
          ) : null}
        </div>
        {plans.length > 0 ? (
          <nav
            className="flex flex-wrap items-center gap-2 text-sm"
            aria-label="Sort plans"
          >
            <span className="text-muted-foreground">Sort</span>
            {sortLinks.map((s) => {
              const params = new URLSearchParams();
              if (s.key) params.set("sort", s.key);
              if (fno) params.set("fno", fno);
              const qs = params.toString();
              const active = (sort ?? undefined) === s.key;
              return (
                <Link
                  key={s.label}
                  href={qs ? `${basePath}?${qs}` : basePath}
                  aria-current={active ? "true" : undefined}
                  className={
                    active
                      ? "inline-flex min-h-9 items-center rounded-full bg-primary px-4 font-medium text-primary-foreground"
                      : "inline-flex min-h-9 items-center rounded-full border bg-card px-4 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  }
                >
                  {s.label}
                </Link>
              );
            })}
          </nav>
        ) : null}
      </div>

      {plans.length === 0 ? (
        <EmptyState
          className="mt-8 bg-card/50"
          title={
            fno
              ? `No published plans on ${fno} right now`
              : "No published plans in this category right now"
          }
          description="Check back soon, or ask us what is coming."
          action={
            <PillLink href="/contact" variant="outline" size="sm">
              Ask us directly
            </PillLink>
          }
        />
      ) : grouped ? (
        providers.map((provider) => (
          <section key={provider} className="mt-10">
            <div className="flex items-baseline justify-between gap-4">
              <h3 className="text-lg font-semibold tracking-tight">
                {provider}
              </h3>
              <Link
                href={`${basePath}?fno=${encodeURIComponent(provider.toLowerCase())}`}
                className="text-sm font-medium text-primary hover:underline"
              >
                Only {provider}
              </Link>
            </div>
            <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {plans
                .filter((p) => p.provider.name === provider)
                .map((plan: PlanWithProvider, index) => (
                  <Reveal
                    key={plan.id}
                    delay={Math.min(index, 5) * 0.05}
                    className="h-full"
                  >
                    <PlanCard plan={plan} headingLevel="h4" />
                  </Reveal>
                ))}
            </div>
          </section>
        ))
      ) : (
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan, index) => (
            <Reveal
              key={plan.id}
              delay={Math.min(index, 5) * 0.05}
              className="h-full"
            >
              <PlanCard plan={plan} />
            </Reveal>
          ))}
        </div>
      )}
    </div>
  );
}
