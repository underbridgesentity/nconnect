import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check } from "lucide-react";
import {
  publishedPlanBySlug,
  publishedPlans,
  publishedHardware,
} from "@/lib/domain/catalogue";
import { formatCents } from "@/lib/money";
import { MoneyText } from "@/components/shared/money-text";
import {
  JsonLd,
  breadcrumbJsonLd,
  offerJsonLd,
} from "@/components/public/json-ld";
import { PageHeader, type HeaderStat } from "@/components/public/page-header";
import { PillLink } from "@/components/public/pill";
import { ProductImage } from "@/components/public/product-image";
import { fileUrl } from "@/lib/storage";
import { appUrl } from "@/lib/config";

export const revalidate = 3600;

export async function generateStaticParams() {
  const plans = await publishedPlans();
  return plans.map((p) => ({ slug: p.slug }));
}

/** Where a plan sits in the site, for the breadcrumb, band photo and schema. */
const CATEGORY: Record<
  string,
  { label: string; path: string; image: string; alt: string }
> = {
  fibre: {
    label: "Fibre",
    path: "/fibre",
    image: "/marketing/fibre.webp",
    alt: "Glowing fibre optic strands in blue light",
  },
  voip: {
    label: "Business VoIP",
    path: "/voip",
    image: "/marketing/voip.webp",
    alt: "A business owner taking a call at her desk",
  },
  sim_data: {
    label: "SIM Data",
    path: "/sim-data",
    image: "/marketing/sim.webp",
    alt: "A hand holding a SIM card next to a smartphone",
  },
  lte_home: {
    label: "Home Internet",
    path: "/internet",
    image: "/marketing/internet.webp",
    alt: "A couple at home on the sofa using fast wireless internet",
  },
  telkom_lte: {
    label: "Home Internet",
    path: "/internet",
    image: "/marketing/internet.webp",
    alt: "A couple at home on the sofa using fast wireless internet",
  },
};

function categoryOf(category: string) {
  return CATEGORY[category] ?? CATEGORY.lte_home;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const plan = await publishedPlanBySlug(slug);
  if (!plan) return { title: "Plan not found" };
  const title = `${plan.name}, ${formatCents(plan.priceCents, {
    whole: true,
  })}/month`;
  const description =
    plan.description ??
    `${plan.name} from Needd Connect: ${plan.dataAllocation ?? ""}`.trim();
  return {
    title,
    description,
    alternates: { canonical: `/plans/${plan.slug}` },
    openGraph: {
      title: `${title} | Needd Connect`,
      description,
      url: `/plans/${plan.slug}`,
      type: "website",
    },
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

  const base = appUrl();
  const category = categoryOf(plan.category);
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
          "Your first invoice is only for the month after activation, the month you paid at checkout starts when the service works.",
        ]
      : [
          "We verify your RICA documents (SIM services are required to by law).",
          "Your SIM and router (if ordered) are prepared and dispatched, delivery within 3 business days.",
          "Insert the SIM, plug in, and you're online. Allow up to 24 hours for the data allocation to reflect.",
          "Your first invoice is only for the month after activation, the month you paid at checkout starts when the service works.",
        ];

  const stats: HeaderStat[] = [
    {
      label: "Monthly",
      value: (
        <>
          <MoneyText cents={plan.priceCents} whole />
          <span className="text-base font-medium text-white/60">/mo</span>
        </>
      ),
    },
    ...(plan.onceOffCents > 0
      ? [
          {
            label: "Once-off",
            value: <MoneyText cents={plan.onceOffCents} whole />,
          },
        ]
      : []),
    ...(plan.speedDownMbps
      ? [
          {
            label: "Speed",
            value: (
              <span className="tnum">
                {plan.speedDownMbps}
                {plan.speedUpMbps ? `/${plan.speedUpMbps}` : ""} Mbps
              </span>
            ),
          },
        ]
      : []),
    {
      label: "Contract",
      value: plan.contractMonths
        ? `${plan.contractMonths} months`
        : "Month to month",
    },
  ];

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Product",
          name: plan.name,
          description: plan.description ?? plan.dataAllocation ?? undefined,
          brand: { "@type": "Brand", name: plan.provider.name },
          url: `${base}/plans/${plan.slug}`,
          image: [`${base}${category.image}`],
          offers: offerJsonLd({
            appUrl: base,
            path: `/plans/${plan.slug}`,
            priceCents: plan.priceCents,
          }),
        }}
      />
      <JsonLd
        data={breadcrumbJsonLd(base, [
          { name: "Home", path: "/" },
          { name: category.label, path: category.path },
          { name: plan.name, path: `/plans/${plan.slug}` },
        ])}
      />

      <PageHeader
        image={category.image}
        imageAlt={category.alt}
        eyebrow={plan.provider.name}
        title={plan.name}
        breadcrumb={[
          { label: "Home", href: "/" },
          { label: category.label, href: category.path },
          { label: plan.name },
        ]}
        stats={stats}
        actions={
          <>
            <PillLink href={`/signup?plan=${plan.slug}`}>
              Sign up for this plan
            </PillLink>
            <PillLink href="/coverage" variant="ink">
              Check coverage first
            </PillLink>
          </>
        }
      >
        {plan.description ? <p>{plan.description}</p> : null}
      </PageHeader>

      <div className="mx-auto max-w-5xl px-4 py-14">
        <div className="grid gap-10 md:grid-cols-2">
          <section>
            <h2 className="text-lg font-semibold tracking-tight">
              What you get
            </h2>
            <ul className="mt-4 space-y-2.5 text-sm leading-6">
              {plan.speedDownMbps ? (
                <li className="flex gap-2.5">
                  <Check
                    className="mt-0.5 size-4 shrink-0 text-primary"
                    aria-hidden
                  />
                  <span>
                    {plan.speedDownMbps}
                    {plan.speedUpMbps ? `/${plan.speedUpMbps}` : ""} Mbps
                    {plan.category === "fibre" ? " (download/upload)" : ""}
                  </span>
                </li>
              ) : null}
              {plan.dataAllocation ? (
                <li className="flex gap-2.5">
                  <Check
                    className="mt-0.5 size-4 shrink-0 text-primary"
                    aria-hidden
                  />
                  <span>{plan.dataAllocation}</span>
                </li>
              ) : null}
              <li className="flex gap-2.5">
                <Check
                  className="mt-0.5 size-4 shrink-0 text-primary"
                  aria-hidden
                />
                <span>One bill from Needd Connect, we handle the network</span>
              </li>
              <li className="flex gap-2.5">
                <Check
                  className="mt-0.5 size-4 shrink-0 text-primary"
                  aria-hidden
                />
                <span>Support on WhatsApp from real local people</span>
              </li>
              {plan.onceOffCents === 0 ? (
                <li className="flex gap-2.5">
                  <Check
                    className="mt-0.5 size-4 shrink-0 text-primary"
                    aria-hidden
                  />
                  <span>
                    No once-off fee on this plan, installation is confirmed
                    with you at signup
                  </span>
                </li>
              ) : null}
            </ul>

            {plan.fupDetail ? (
              <>
                <h2 className="mt-8 text-lg font-semibold tracking-tight">
                  Fair usage, in plain language
                </h2>
                <p className="mt-3 text-sm leading-6 text-foreground/80">
                  {plan.fupDetail}
                </p>
              </>
            ) : null}
          </section>

          <section>
            <h2 className="text-lg font-semibold tracking-tight">
              What happens after signup
            </h2>
            <ol className="mt-4 space-y-3 text-sm leading-6 text-foreground/80">
              {afterSignup.map((step, i) => (
                <li key={i} className="flex gap-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-foreground">
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>

        {suggestions.length > 0 ? (
          <section className="mt-14">
            <h2 className="text-lg font-semibold tracking-tight">
              Hardware that fits this plan
            </h2>
            <div className="mt-4 grid gap-5 sm:grid-cols-3">
              {suggestions.map((h, i) => (
                <Link
                  key={h.id}
                  href={`/hardware/${h.sku}`}
                  className="card-hover img-zoom group flex flex-col rounded-3xl border bg-card p-4"
                >
                  <ProductImage src={suggestionUrls[i]} alt={h.name} />
                  <h3 className="mt-3 text-sm font-semibold">{h.name}</h3>
                  <p className="mt-1">
                    <MoneyText
                      cents={h.priceCents}
                      whole
                      className="font-semibold"
                    />
                  </p>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        <div className="mt-14 flex flex-wrap items-center gap-3 rounded-3xl border bg-card p-6">
          <p className="flex-1 text-sm text-foreground/80">
            Ready to go, or still deciding? We check coverage at your address
            before you pay a cent.
          </p>
          <PillLink href={`/signup?plan=${plan.slug}`}>
            Sign up for this plan
          </PillLink>
          <PillLink href="/coverage" variant="outline">
            Check coverage
          </PillLink>
        </div>
      </div>
    </>
  );
}
