import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight,
  MessageCircle,
  Receipt,
  Headset,
  ShieldCheck,
} from "lucide-react";
import { publishedPlans, bundlesWithItems } from "@/lib/domain/catalogue";
import { getSettingForDisplay } from "@/lib/domain/settings";
import { MoneyText } from "@/components/shared/money-text";
import { Reveal } from "@/components/shared/reveal";
import { JsonLd, organizationJsonLd } from "@/components/public/json-ld";
import { PlanCard } from "@/components/public/plan-card";
import { PillLink } from "@/components/public/pill";
import { bundleSavingCents } from "@/components/public/bundle-pricing";
import { WhatsAppPill } from "@/components/public/whatsapp-link";
import { whatsappHref, type CompanySettings } from "@/components/public/whatsapp";
import { appUrl } from "@/lib/config";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Needd Connect | One provider, one bill, local support",
  description:
    "Uncapped LTE, 5G and fibre from R331/month, business VoIP and SIM data deals. One provider, one bill, real local support on WhatsApp.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Needd Connect | One provider, one bill, local support",
    description:
      "Uncapped LTE, 5G and fibre, business VoIP and SIM data deals across South Africa.",
    url: "/",
    type: "website",
  },
  twitter: { card: "summary_large_image" },
};

const CATEGORIES = [
  {
    href: "/internet",
    image: "/marketing/internet.webp",
    title: "Home Internet",
    blurb: "Uncapped LTE and 5G. Plug in and you're online, no fixed line needed.",
  },
  {
    href: "/fibre",
    image: "/marketing/fibre.webp",
    title: "Fibre",
    blurb: "Uncapped, unshaped fibre on Openserve, Vumatel, Frogfoot and MetroFibre.",
  },
  {
    href: "/voip",
    image: "/marketing/voip.webp",
    title: "Business VoIP",
    blurb: "Cloud phone systems with call recording, IVR and per-second billing.",
  },
  {
    href: "/sim-data",
    image: "/marketing/sim.webp",
    title: "SIM Data",
    blurb: "Capped LTE data deals on 24-month terms. SIM only, use your router.",
  },
  {
    href: "/hardware",
    image: "/marketing/creators.webp",
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
    a: "Yes, with a fair-usage policy. Each plan includes a full-speed allocation; after that, speed steps down but you stay online. The exact numbers are on every plan page, no surprises.",
  },
  {
    q: "How long does activation take?",
    a: "LTE and 5G are usually live within one working day of delivery. Fibre depends on the operator: if your address needs an installation, we tell you the timeline upfront.",
  },
  {
    q: "What do I need for RICA?",
    a: "South African law requires ID and proof of address for any SIM-based service. You upload both during signup. It takes two minutes with your phone camera.",
  },
  {
    q: "Can I cancel?",
    a: "Month-to-month plans cancel at the end of your billing cycle from your customer portal. No phone calls, no retention scripts you can't skip. SIM data deals run on 24-month terms as shown on the plan.",
  },
];

export default async function HomePage() {
  const base = appUrl();
  const [allPlans, bundles, company] = await Promise.all([
    publishedPlans(),
    bundlesWithItems({ publishedOnly: true }).then((b) =>
      b.filter((x) => x.featured)
    ),
    getSettingForDisplay<CompanySettings>("company"),
  ]);

  const featured = allPlans.filter((p) => p.featured).slice(0, 3);
  // Hero figures are derived from the live catalogue, never typed into copy,
  // so a price change in admin can never leave a stale claim on the home page.
  const fromCents =
    allPlans.length > 0
      ? Math.min(...allPlans.map((p) => p.priceCents))
      : null;
  const fibreNetworks = new Set(
    allPlans.filter((p) => p.category === "fibre").map((p) => p.provider.name)
  ).size;
  const wa = whatsappHref(
    company,
    "Hi Needd Connect, I would like to know which plan suits my address."
  );

  return (
    <>
      <JsonLd data={organizationJsonLd(base, company)} />
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

      {/*
        Hero: full-bleed photography over brand ink. Nothing above the fold is
        wrapped in Reveal, so the headline and both calls to action paint from
        the server HTML instead of waiting for hydration.
      */}
      <section
        data-surface="ink"
        className="relative isolate overflow-hidden bg-[#121829]"
      >
        <Image
          src="/marketing/hero.webp"
          alt="A couple relaxing at home, streaming on fast internet"
          fill
          priority
          sizes="100vw"
          className="object-cover object-center opacity-90"
        />
        <div className="hero-scrim absolute inset-0" aria-hidden />
        <div className="relative mx-auto flex min-h-[560px] max-w-6xl flex-col justify-center px-4 py-24 md:min-h-[640px]">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-xs font-medium text-white backdrop-blur">
            <span className="size-1.5 rounded-full bg-emerald-400" aria-hidden />
            Accredited reseller of MTN, Vodacom and Telkom
          </span>
          <h1 className="mt-6 max-w-2xl text-4xl font-semibold leading-tight tracking-tight text-white md:text-6xl">
            Internet without the run-around.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-white/75">
            One provider, one bill, local support. Uncapped LTE, 5G and fibre
            across South Africa, with real people answering on WhatsApp.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <PillLink href="/coverage" className="px-7">
              Check coverage at my address
              <ArrowRight
                className="size-4 transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </PillLink>
            <PillLink href="/internet" variant="ink" className="px-7">
              Browse plans
            </PillLink>
          </div>
          <dl className="mt-12 flex flex-wrap gap-x-10 gap-y-4 text-white/85">
            {fromCents ? (
              <div>
                <dt className="text-xs uppercase tracking-wider text-white/50">
                  Plans from
                </dt>
                <dd className="text-2xl font-semibold">
                  <MoneyText cents={fromCents} whole />
                  <span className="text-base font-medium text-white/60">
                    /mo
                  </span>
                </dd>
              </div>
            ) : null}
            {fibreNetworks > 0 ? (
              <div>
                <dt className="text-xs uppercase tracking-wider text-white/50">
                  Fibre networks
                </dt>
                <dd className="tnum text-2xl font-semibold">{fibreNetworks}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-xs uppercase tracking-wider text-white/50">
                Support
              </dt>
              <dd className="text-2xl font-semibold">WhatsApp-first</dd>
            </div>
          </dl>
        </div>
      </section>

      {/* Category cards with photography */}
      <section className="mx-auto max-w-6xl px-4 py-20">
        <Reveal>
          <h2 className="text-3xl font-semibold tracking-tight">
            What do you need?
          </h2>
          <p className="mt-2 text-muted-foreground">
            Five ways to get connected, one bill at the end.
          </p>
        </Reveal>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {CATEGORIES.map((cat, index) => (
            <Reveal
              key={cat.href}
              delay={index * 0.07}
              className={
                index === 0 ? "h-full sm:col-span-2 lg:col-span-1" : "h-full"
              }
            >
              <Link
                href={cat.href}
                className="card-hover img-zoom group flex h-full flex-col overflow-hidden rounded-3xl border bg-card"
              >
                <div className="relative h-44 overflow-hidden">
                  <Image
                    src={cat.image}
                    alt=""
                    fill
                    sizes={
                      index === 0
                        ? "(min-width: 1024px) 360px, 100vw"
                        : "(min-width: 1024px) 360px, (min-width: 640px) 50vw, 100vw"
                    }
                    className="object-cover"
                  />
                  <div
                    className="absolute inset-0 bg-gradient-to-t from-black/45 via-black/5 to-transparent"
                    aria-hidden
                  />
                  <h3 className="absolute bottom-4 left-5 text-lg font-semibold text-white drop-shadow">
                    {cat.title}
                  </h3>
                </div>
                <div className="flex flex-1 items-center justify-between gap-3 p-5">
                  <p className="text-sm text-muted-foreground">{cat.blurb}</p>
                  <span
                    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground transition-colors group-hover:bg-primary group-hover:text-white"
                    aria-hidden
                  >
                    <ArrowRight className="size-4" />
                  </span>
                </div>
              </Link>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Featured plans: the same PlanCard the category pages use */}
      {featured.length > 0 ? (
        <section className="border-y bg-card">
          <div className="mx-auto max-w-6xl px-4 py-20">
            <Reveal>
              <h2 className="text-3xl font-semibold tracking-tight">
                Popular right now
              </h2>
              <p className="mt-2 text-muted-foreground">
                The plans people pick most, at the price you actually pay.
              </p>
            </Reveal>
            <div className="mt-8 grid gap-5 sm:grid-cols-3">
              {featured.map((plan, index) => (
                <Reveal key={plan.id} delay={index * 0.08} className="h-full">
                  <PlanCard plan={plan} />
                </Reveal>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* Featured bundles */}
      {bundles.length > 0 ? (
        <section className="mx-auto max-w-6xl px-4 py-20">
          <Reveal>
            <h2 className="text-3xl font-semibold tracking-tight">
              Grab this deal
            </h2>
            <p className="mt-2 text-muted-foreground">
              A plan and the hardware that fits it, at one price.
            </p>
          </Reveal>
          <div className="mt-8 grid gap-5 sm:grid-cols-2">
            {bundles.map((b, index) => {
              const saving = bundleSavingCents(b);
              return (
                <Reveal key={b.id} delay={index * 0.08} className="h-full">
                  <Link
                    href={`/bundles/${b.slug}`}
                    className="card-hover flex h-full flex-col rounded-3xl border bg-card p-6"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-lg font-semibold">{b.name}</h3>
                      {saving ? (
                        <span className="shrink-0 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground">
                          Save <MoneyText cents={saving} whole />
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {b.description}
                    </p>
                    <p className="mt-4 flex flex-1 items-end">
                      <MoneyText
                        cents={b.priceCents}
                        whole
                        className="text-2xl font-semibold"
                      />
                    </p>
                  </Link>
                </Reveal>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Image band: the promise */}
      <section
        data-surface="ink"
        className="relative isolate overflow-hidden bg-[#121829]"
      >
        <Image
          src="/marketing/family.webp"
          alt="A family at home enjoying time online together"
          fill
          sizes="100vw"
          className="object-cover opacity-40"
        />
        <div
          className="absolute inset-0 bg-gradient-to-r from-[#121829]/95 via-[#121829]/70 to-[#121829]/40"
          aria-hidden
        />
        <div className="relative mx-auto max-w-6xl px-4 py-24">
          <div className="max-w-xl">
            <Reveal>
              <h2 className="text-3xl font-semibold tracking-tight text-white md:text-4xl">
                The middleman, done right.
              </h2>
              <p className="mt-4 text-white/75">
                We buy wholesale from the networks and sell to you directly.
                That means you never phone a network call centre again: one
                provider, one bill, and support from people who know your
                account by name.
              </p>
            </Reveal>
            <div className="mt-10 grid gap-6 sm:grid-cols-3">
              {[
                { icon: MessageCircle, label: "WhatsApp-first support" },
                { icon: Receipt, label: "One honest bill" },
                { icon: ShieldCheck, label: "POPIA and RICA compliant" },
              ].map((item, index) => (
                <Reveal key={item.label} delay={index * 0.08}>
                  <div className="flex items-center gap-3 text-white">
                    <span className="flex size-10 items-center justify-center rounded-full bg-white/10">
                      <item.icon className="size-5" aria-hidden />
                    </span>
                    <span className="text-sm font-medium">{item.label}</span>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-4 py-20">
        <Reveal>
          <h2 className="text-3xl font-semibold tracking-tight">How it works</h2>
        </Reveal>
        <div className="mt-8 grid gap-6 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <Reveal key={step.title} delay={index * 0.1} className="h-full">
              <div className="card-hover h-full rounded-3xl border bg-card p-6">
                <span className="flex size-10 items-center justify-center rounded-full bg-primary text-sm font-bold text-white">
                  {index + 1}
                </span>
                <h3 className="mt-4 font-semibold">{step.title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  {step.body}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Trust strip */}
      <section className="border-y bg-card">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-16 sm:grid-cols-3">
          {[
            {
              icon: MessageCircle,
              title: "WhatsApp-first support",
              body: "Your order updates, invoices and support all happen where you already are.",
            },
            {
              icon: Receipt,
              title: "One honest bill",
              body: "Fixed monthly pricing in Rands, invoiced on your activation date. No surprise increases mid-contract.",
            },
            {
              icon: Headset,
              title: "Accredited reseller",
              body: "MTN, Vodacom and Telkom accredited, with fibre on Openserve, Vumatel, Frogfoot and MetroFibre.",
            },
          ].map((item, index) => (
            <Reveal key={item.title} delay={index * 0.08}>
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-primary">
                  <item.icon className="size-5" aria-hidden />
                </span>
                <div>
                  <h3 className="font-semibold">{item.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{item.body}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* FAQ. Reveal renders the card itself so the dl stays dl > div > dt/dd. */}
      <section className="mx-auto max-w-3xl px-4 py-20">
        <Reveal>
          <h2 className="text-3xl font-semibold tracking-tight">
            Questions people actually ask
          </h2>
        </Reveal>
        <dl className="mt-8 space-y-3">
          {FAQS.map((f, index) => (
            <Reveal
              key={f.q}
              delay={index * 0.05}
              className="rounded-2xl border bg-card p-5"
            >
              <dt className="font-semibold">{f.q}</dt>
              <dd className="mt-1.5 text-sm leading-6 text-foreground/80">
                {f.a}
              </dd>
            </Reveal>
          ))}
        </dl>
        <Reveal>
          <p className="mt-8 text-sm text-muted-foreground">
            Something else?{" "}
            <Link href="/help" className="font-medium text-primary hover:underline">
              See the full FAQ
            </Link>{" "}
            or{" "}
            <Link
              href="/contact"
              className="font-medium text-primary hover:underline"
            >
              talk to us
            </Link>
            .
          </p>
        </Reveal>
      </section>

      {/* Closing CTA band */}
      <section data-surface="ink" className="bg-[#121829]">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-16 md:flex-row md:items-center md:justify-between">
          <Reveal>
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-white md:text-3xl">
                Ready when you are.
              </h2>
              <p className="mt-2 text-white/70">
                Check your address first. It takes thirty seconds and we never
                promise coverage we can&apos;t deliver.
              </p>
            </div>
          </Reveal>
          <Reveal delay={0.1}>
            <div className="flex flex-wrap gap-3">
              <PillLink href="/coverage" className="px-8">
                Check my coverage
                <ArrowRight
                  className="size-4 transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </PillLink>
              {wa ? (
                <WhatsAppPill href={wa} variant="ink" className="px-8" />
              ) : null}
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
