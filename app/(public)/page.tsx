import type { Metadata } from "next";
import Link from "next/link";
import {
  Wifi,
  Cable,
  PhoneCall,
  Smartphone,
  Router,
  MessageCircle,
  Receipt,
  Headset,
} from "lucide-react";
import {
  publishedPlans,
  bundlesWithItems,
} from "@/lib/domain/catalogue";
import { MoneyText } from "@/components/shared/money-text";
import { JsonLd, organizationJsonLd } from "@/components/public/json-ld";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Needd Connect — One provider, one bill, local support",
  description:
    "Uncapped LTE, 5G and fibre from R331/month, business VoIP and SIM data deals. One provider, one bill, real support on WhatsApp — across South Africa.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Needd Connect — One provider, one bill, local support",
    description:
      "Uncapped LTE, 5G and fibre, business VoIP and SIM data deals across South Africa.",
    type: "website",
  },
};

const CATEGORIES = [
  {
    href: "/internet",
    icon: Wifi,
    title: "Home Internet",
    blurb: "Uncapped LTE and 5G — plug in and you're online. No fixed line needed.",
  },
  {
    href: "/fibre",
    icon: Cable,
    title: "Fibre",
    blurb: "Uncapped, unshaped fibre on Openserve, Vumatel, Frogfoot and MetroFibre.",
  },
  {
    href: "/voip",
    icon: PhoneCall,
    title: "Business VoIP",
    blurb: "Cloud phone systems with call recording, IVR and per-second billing.",
  },
  {
    href: "/sim-data",
    icon: Smartphone,
    title: "SIM Data",
    blurb: "Capped LTE data deals on 24-month terms — SIM only, use your router.",
  },
  {
    href: "/hardware",
    icon: Router,
    title: "Hardware",
    blurb: "Approved routers, mesh Wi-Fi, extenders, VoIP phones and back-up power.",
  },
];

const STEPS = [
  {
    title: "Pick your plan",
    body: "Choose LTE, 5G or fibre. We check coverage at your address before you pay.",
  },
  {
    title: "Pay securely online",
    body: "First month plus any hardware, by card. We only start once payment clears.",
  },
  {
    title: "We set you up",
    body: "We activate your service and keep you posted on WhatsApp until you're online.",
  },
];

const FAQS = [
  {
    q: "Who is my provider if I sign up through Needd Connect?",
    a: "We are. Needd Connect buys wholesale from the networks and fibre operators, and you deal only with us: one bill, one support number, no call centres.",
  },
  {
    q: "Is the LTE really uncapped?",
    a: "Yes, with a fair-usage policy. Each plan includes a full-speed allocation; after that, speed steps down but you stay online. The exact numbers are on every plan page — no surprises.",
  },
  {
    q: "How long does activation take?",
    a: "LTE and 5G are usually live within one working day of delivery. Fibre depends on the operator: if your address needs an installation, we tell you the timeline upfront.",
  },
  {
    q: "What do I need for RICA?",
    a: "South African law requires ID and proof of address for any SIM-based service. You upload both during signup — takes two minutes with your phone camera.",
  },
  {
    q: "Can I cancel?",
    a: "Month-to-month plans cancel at the end of your billing cycle from your customer portal — no phone calls, no retention scripts you can't skip. SIM data deals run on 24-month terms as shown on the plan.",
  },
];

export default async function HomePage() {
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const [featured, bundles] = await Promise.all([
    publishedPlans().then((plans) => plans.filter((p) => p.featured).slice(0, 3)),
    bundlesWithItems({ publishedOnly: true }).then((b) =>
      b.filter((x) => x.featured)
    ),
  ]);

  return (
    <>
      <JsonLd data={organizationJsonLd(appUrl)} />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: FAQS.map((f) => ({
            "@type": "Question",
            name: f.q,
            acceptedAnswer: { "@type": "Answer", text: f.a },
          })),
        }}
      />

      {/* Hero */}
      <section className="border-b bg-card">
        <div className="mx-auto max-w-6xl px-4 py-16 md:py-24">
          <div className="max-w-2xl">
            <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
              Internet without the run-around.
            </h1>
            <p className="mt-4 text-lg text-muted-foreground">
              One provider, one bill, local support. Uncapped LTE, 5G and fibre
              across South Africa — with real people answering on WhatsApp.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/coverage"
                className="flex touch-target items-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Check coverage at my address
              </Link>
              <Link
                href="/internet"
                className="flex touch-target items-center rounded-md border px-6 text-sm font-medium hover:bg-accent"
              >
                Browse plans
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Category cards */}
      <section className="mx-auto max-w-6xl px-4 py-14">
        <h2 className="text-2xl font-semibold tracking-tight">
          What do you need?
        </h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {CATEGORIES.map((cat) => (
            <Link
              key={cat.href}
              href={cat.href}
              className="group rounded-lg border bg-card p-5 transition-shadow hover:shadow-sm"
            >
              <cat.icon className="size-6 text-primary" aria-hidden />
              <h3 className="mt-3 font-semibold group-hover:text-primary">
                {cat.title}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">{cat.blurb}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* Featured plans */}
      {featured.length > 0 ? (
        <section className="border-y bg-card">
          <div className="mx-auto max-w-6xl px-4 py-14">
            <h2 className="text-2xl font-semibold tracking-tight">
              Popular right now
            </h2>
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              {featured.map((plan) => (
                <Link
                  key={plan.id}
                  href={`/plans/${plan.slug}`}
                  className="rounded-lg border bg-background p-5 hover:shadow-sm"
                >
                  <p className="text-sm text-muted-foreground">
                    {plan.provider.name}
                  </p>
                  <h3 className="font-semibold">{plan.name}</h3>
                  <p className="mt-2">
                    <MoneyText
                      cents={plan.priceCents}
                      whole
                      className="text-2xl font-semibold"
                    />
                    <span className="text-sm text-muted-foreground"> /month</span>
                  </p>
                  {plan.dataAllocation ? (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {plan.dataAllocation}
                    </p>
                  ) : null}
                </Link>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* Featured bundles */}
      {bundles.length > 0 ? (
        <section className="mx-auto max-w-6xl px-4 py-14">
          <h2 className="text-2xl font-semibold tracking-tight">
            Grab this deal
          </h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {bundles.map((b) => (
              <Link
                key={b.id}
                href={`/bundles/${b.slug}`}
                className="rounded-lg border bg-card p-5 hover:shadow-sm"
              >
                <h3 className="font-semibold">{b.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {b.description}
                </p>
                <p className="mt-2">
                  <MoneyText
                    cents={b.priceCents}
                    whole
                    className="text-xl font-semibold"
                  />
                </p>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* How it works */}
      <section className="border-y bg-card">
        <div className="mx-auto max-w-6xl px-4 py-14">
          <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
          <div className="mt-6 grid gap-6 sm:grid-cols-3">
            {STEPS.map((step, i) => (
              <div key={step.title}>
                <span className="flex size-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                  {i + 1}
                </span>
                <h3 className="mt-3 font-semibold">{step.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Trust strip */}
      <section className="mx-auto max-w-6xl px-4 py-14">
        <div className="grid gap-6 sm:grid-cols-3">
          <div className="flex items-start gap-3">
            <MessageCircle className="mt-0.5 size-5 text-primary" aria-hidden />
            <div>
              <h3 className="font-semibold">WhatsApp-first support</h3>
              <p className="text-sm text-muted-foreground">
                Your order updates, invoices and support all happen where you
                already are.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Receipt className="mt-0.5 size-5 text-primary" aria-hidden />
            <div>
              <h3 className="font-semibold">One honest bill</h3>
              <p className="text-sm text-muted-foreground">
                Fixed monthly pricing in Rands, invoiced on your activation
                date. No surprise increases mid-contract.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Headset className="mt-0.5 size-5 text-primary" aria-hidden />
            <div>
              <h3 className="font-semibold">Accredited reseller</h3>
              <p className="text-sm text-muted-foreground">
                MTN, Vodacom and Telkom accredited, with fibre on Openserve,
                Vumatel, Frogfoot and MetroFibre.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="border-t bg-card">
        <div className="mx-auto max-w-3xl px-4 py-14">
          <h2 className="text-2xl font-semibold tracking-tight">
            Questions people actually ask
          </h2>
          <dl className="mt-6 space-y-6">
            {FAQS.map((f) => (
              <div key={f.q}>
                <dt className="font-semibold">{f.q}</dt>
                <dd className="mt-1 text-sm text-muted-foreground">{f.a}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-8 text-sm text-muted-foreground">
            Something else?{" "}
            <Link href="/help" className="text-primary hover:underline">
              See the full FAQ
            </Link>{" "}
            or{" "}
            <Link href="/contact" className="text-primary hover:underline">
              talk to us
            </Link>
            .
          </p>
        </div>
      </section>
    </>
  );
}
