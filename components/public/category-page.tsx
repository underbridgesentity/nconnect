import Link from "next/link";
import { publishedPlans, type PlanWithProvider } from "@/lib/domain/catalogue";
import { PlanCard } from "@/components/public/plan-card";

/**
 * Shared category listing (spec §9.1): published plans, sortable via server-
 * driven query params so every filtered view is a crawlable URL. No JS needed.
 */

export type CategoryKey = "lte_home" | "telkom_lte" | "fibre" | "voip" | "sim_data";

export async function CategoryPlanList({
  categories,
  basePath,
  sort,
  groupByProvider = false,
  fno,
}: {
  categories: CategoryKey[];
  basePath: string;
  sort?: string;
  groupByProvider?: boolean;
  fno?: string;
}) {
  const lists = await Promise.all(categories.map((c) => publishedPlans(c)));
  let plans = lists.flat();

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

  return (
    <div>
      <nav
        className="flex flex-wrap items-center gap-2 text-sm"
        aria-label="Sort plans"
      >
        <span className="text-muted-foreground">Sort:</span>
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
              className={
                active
                  ? "rounded-full bg-primary px-3 py-1 font-medium text-primary-foreground"
                  : "rounded-full border px-3 py-1 text-muted-foreground hover:bg-accent"
              }
            >
              {s.label}
            </Link>
          );
        })}
      </nav>

      {plans.length === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No published plans in this category right now. Check back soon or{" "}
          <Link href="/contact" className="text-primary hover:underline">
            ask us directly
          </Link>
          .
        </p>
      ) : groupByProvider && !sort && !fno ? (
        providers.map((provider) => (
          <section key={provider} className="mt-8">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-semibold">{provider}</h2>
              <Link
                href={`${basePath}?fno=${encodeURIComponent(provider.toLowerCase())}`}
                className="text-sm text-primary hover:underline"
              >
                Only {provider}
              </Link>
            </div>
            <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {plans
                .filter((p) => p.provider.name === provider)
                .map((plan: PlanWithProvider) => (
                  <PlanCard key={plan.id} plan={plan} />
                ))}
            </div>
          </section>
        ))
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} />
          ))}
        </div>
      )}
    </div>
  );
}
