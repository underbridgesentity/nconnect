import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check } from "lucide-react";
import {
  publishedPlanBySlug,
  publishedPlans,
  publishedHardware,
} from "@/lib/domain/catalogue";
import { MoneyText } from "@/components/shared/money-text";
import { JsonLd } from "@/components/public/json-ld";
import { fileUrl } from "@/lib/storage";

export const revalidate = 3600;

export async function generateStaticParams() {
  const plans = await publishedPlans();
  return plans.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const plan = await publishedPlanBySlug(slug);
  if (!plan) return { title: "Plan not found" };
  return {
    title: `${plan.name} — R${Math.round(plan.priceCents / 100)}/month`,
    description:
      plan.description ??
      `${plan.name} from Needd Connect: ${plan.dataAllocation ?? ""}`.trim(),
    alternates: { canonical: `/plans/${plan.slug}` },
  };
}

const HW_SUGGESTIONS: Record<string, string[]> = {
  lte_home: ["router_lte", "router_5g"],
  telkom_lte: ["router_lte"],
  sim_data: ["router_lte"],
  fibre: ["router_fibre", "mesh"],
  voip: ["voip_phone"],
};

export default async function PlanDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const plan = await publishedPlanBySlug(slug);
  if (!plan) notFound();

  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const suggestionCategories = HW_SUGGESTIONS[plan.category] ?? [];
  const allHw = await publishedHardware();
  const suggestions = allHw
    .filter((h) => suggestionCategories.includes(h.category))
    .slice(0, 3);
  const suggestionUrls = await Promise.all(
    suggestions.map((h) =>
      h.imagePath ? fileUrl("catalogue", h.imagePath) : Promise.resolve(null)
    )
  );

  const afterSignup: string[] =
    plan.category === "fibre"
      ? [
          "We confirm fibre availability at your address within one business day, on WhatsApp.",
          "Once confirmed, the fibre operator schedules any installation needed.",
          "We activate your line and message you the moment it's live.",
          "Your first invoice is only for the month after activation — the month you paid at checkout starts when the service works.",
        ]
      : [
          "We verify your RICA documents (SIM services are required to by law).",
          "Your SIM and router (if ordered) are prepared and dispatched — delivery within 3 business days.",
          "Insert the SIM, plug in, and you're online. Allow up to 24 hours for the data allocation to reflect.",
          "Your first invoice is only for the month after activation — the month you paid at checkout starts when the service works.",
        ];

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Product",
          name: plan.name,
          description: plan.description ?? plan.dataAllocation ?? undefined,
          brand: { "@type": "Brand", name: plan.provider.name },
          url: `${appUrl}/plans/${plan.slug}`,
          offers: {
            "@type": "Offer",
            price: (plan.priceCents / 100).toFixed(2),
            priceCurrency: "ZAR",
            availability: "https://schema.org/InStock",
            url: `${appUrl}/plans/${plan.slug}`,
          },
        }}
      />

      <nav className="text-sm text-muted-foreground" aria-label="Breadcrumb">
        <Link href="/" className="hover:text-foreground">
          Home
        </Link>{" "}
        /{" "}
        <Link
          href={
            plan.category === "fibre"
              ? "/fibre"
              : plan.category === "voip"
                ? "/voip"
                : plan.category === "sim_data"
                  ? "/sim-data"
                  : "/internet"
          }
          className="hover:text-foreground"
        >
          {plan.category === "fibre"
            ? "Fibre"
            : plan.category === "voip"
              ? "Business VoIP"
              : plan.category === "sim_data"
                ? "SIM Data"
                : "Home Internet"}
        </Link>{" "}
        / {plan.name}
      </nav>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-6">
        <div>
          <p className="text-sm text-muted-foreground">{plan.provider.name}</p>
          <h1 className="text-3xl font-semibold tracking-tight">{plan.name}</h1>
          {plan.description ? (
            <p className="mt-2 max-w-xl text-muted-foreground">
              {plan.description}
            </p>
          ) : null}
        </div>
        <div className="rounded-lg border bg-card p-5 text-right">
          <p>
            <MoneyText
              cents={plan.priceCents}
              whole
              className="text-3xl font-semibold"
            />
            <span className="text-sm text-muted-foreground"> /month</span>
          </p>
          {plan.onceOffCents > 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Once-off: <MoneyText cents={plan.onceOffCents} whole />
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              No once-off fee seeded — installation confirmed at signup
            </p>
          )}
          {plan.contractMonths ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {plan.contractMonths}-month term
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">Month to month</p>
          )}
          <Link
            href={`/signup?plan=${plan.slug}`}
            className="mt-4 flex touch-target items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Sign up for this plan
          </Link>
        </div>
      </div>

      <div className="mt-10 grid gap-8 md:grid-cols-2">
        <section>
          <h2 className="text-lg font-semibold">What you get</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {plan.speedDownMbps ? (
              <li className="flex gap-2">
                <Check className="mt-0.5 size-4 text-primary" aria-hidden />
                {plan.speedDownMbps}
                {plan.speedUpMbps ? `/${plan.speedUpMbps}` : ""} Mbps
                {plan.category === "fibre" ? " (download/upload)" : ""}
              </li>
            ) : null}
            {plan.dataAllocation ? (
              <li className="flex gap-2">
                <Check className="mt-0.5 size-4 text-primary" aria-hidden />
                {plan.dataAllocation}
              </li>
            ) : null}
            <li className="flex gap-2">
              <Check className="mt-0.5 size-4 text-primary" aria-hidden />
              One bill from Needd Connect — we handle the network
            </li>
            <li className="flex gap-2">
              <Check className="mt-0.5 size-4 text-primary" aria-hidden />
              Support on WhatsApp from real local people
            </li>
          </ul>

          {plan.fupDetail ? (
            <>
              <h2 className="mt-6 text-lg font-semibold">
                Fair usage, in plain language
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {plan.fupDetail}
              </p>
            </>
          ) : null}
        </section>

        <section>
          <h2 className="text-lg font-semibold">What happens after signup</h2>
          <ol className="mt-3 space-y-2 text-sm text-muted-foreground">
            {afterSignup.map((step, i) => (
              <li key={i} className="flex gap-2">
                <span className="font-semibold text-foreground">{i + 1}.</span>
                {step}
              </li>
            ))}
          </ol>
        </section>
      </div>

      {suggestions.length > 0 ? (
        <section className="mt-12">
          <h2 className="text-lg font-semibold">Hardware that fits this plan</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            {suggestions.map((h, i) => (
              <Link
                key={h.id}
                href={`/hardware/${h.sku}`}
                className="rounded-lg border bg-card p-4 hover:shadow-sm"
              >
                {suggestionUrls[i] ? (
                  // eslint-disable-next-line @next/next/no-img-element -- storage URLs
                  <img
                    src={suggestionUrls[i]!}
                    alt={h.name}
                    className="mb-2 h-24 w-full rounded object-contain"
                  />
                ) : null}
                <h3 className="text-sm font-medium">{h.name}</h3>
                <p className="mt-1">
                  <MoneyText cents={h.priceCents} whole className="font-semibold" />
                </p>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
