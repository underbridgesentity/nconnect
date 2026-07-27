import type { Metadata } from "next";
import Link from "next/link";
import { getSetting, getSettingForDisplay } from "@/lib/domain/settings";
import { JsonLd } from "@/components/public/json-ld";
import { PageHeader } from "@/components/public/page-header";
import { PillLink } from "@/components/public/pill";
import { WhatsAppPill } from "@/components/public/whatsapp-link";
import { Reveal } from "@/components/shared/reveal";
import { whatsappHref, type CompanySettings } from "@/components/public/whatsapp";

export const metadata: Metadata = {
  title: "Help & FAQ",
  description:
    "Answers on coverage, billing, RICA, activation times, suspensions and cancellations at Needd Connect.",
  alternates: { canonical: "/help" },
  openGraph: {
    title: "Help & FAQ | Needd Connect",
    description:
      "Straight answers on coverage, billing, RICA, activation, suspension and cancellation.",
    url: "/help",
    type: "website",
  },
};

const SECTIONS: { title: string; faqs: { q: string; a: string }[] }[] = [
  {
    title: "Getting connected",
    faqs: [
      {
        q: "How do I know which plan suits me?",
        a: "Streaming and working from home? Start at 300GB full-speed (LTE Plus) or 30Mbps fibre. Big households and heavy streaming want 50Mbps+ fibre or the LTE Advanced/Max plans. If you tell us on WhatsApp how many people and screens are in the house, we'll give you a straight recommendation.",
      },
      {
        q: "Do I need a special router?",
        a: "For MTN/Vodacom LTE and 5G, yes, the router must be network-approved, and we sell approved models. Telkom LTE works with any LTE-compatible device. Fibre routers connect to the operator's equipment; ours are pre-configured.",
      },
      {
        q: "How long until I'm online?",
        a: "LTE/5G: hardware delivery within 3 business days, then instant activation, allow up to 24 hours for the data allocation to reflect. Fibre: depends on whether your address needs an installation; we tell you the timeline before you commit.",
      },
    ],
  },
  {
    title: "RICA and paperwork",
    faqs: [
      {
        q: "Why do you need my ID and proof of address?",
        a: "RICA, South African law, requires it for any SIM-based service. You upload both during signup. We store them encrypted, use them only for RICA verification, and retain them only as long as the law requires.",
      },
      {
        q: "What counts as proof of address?",
        a: "A municipal bill, bank statement or lease agreement showing your name and address, no older than three months. A clear photo is fine.",
      },
    ],
  },
  {
    title: "Billing",
    faqs: [
      {
        q: "When do I get billed?",
        a: "You pay your first month (plus hardware and once-off fees) at checkout. After activation, your monthly invoice lands on the same date each month, the date your service went live, not the date you ordered.",
      },
      {
        q: "What payment methods do you accept?",
        a: "Card payments via PayFast, with the option to save your card for automatic monthly billing. EFT works too, your invoice carries the banking details and reference.",
      },
      {
        q: "What happens if a payment fails?",
        a: "We retry your card and remind you on WhatsApp and email. If an invoice is 10 days overdue the service is suspended, pay the outstanding invoice and it reactivates automatically. We'd rather warn you early than surprise you.",
      },
    ],
  },
  {
    title: "Changes and cancellation",
    faqs: [
      {
        q: "Can I upgrade or downgrade?",
        a: "Yes, from your portal. Upgrades take effect immediately with a fair pro-rata adjustment shown before you confirm. Downgrades take effect at your next billing date, so you never lose paid-for service.",
      },
      {
        q: "How do I cancel?",
        a: "In your portal, under the service. Month-to-month services cancel at the end of the current billing period. We'll ask once if a cheaper plan or a support conversation would fix the issue, one screen, not a retention marathon.",
      },
    ],
  },
];

export default async function HelpPage() {
  const company = await getSettingForDisplay<CompanySettings>("company");
  const wa = whatsappHref(
    company,
    "Hi Needd Connect, I could not find the answer on your help page."
  );

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: SECTIONS.flatMap((s) =>
            s.faqs.map((f) => ({
              "@type": "Question",
              name: f.q,
              acceptedAnswer: { "@type": "Answer", text: f.a },
            }))
          ),
        }}
      />
      <PageHeader
        image="/marketing/family.webp"
        imageAlt="A family at home enjoying time online together"
        imagePosition="50% 35%"
        eyebrow="Help"
        title="Straight answers, no runaround"
        actions={
          <>
            {wa ? (
              <WhatsAppPill href={wa}>Ask on WhatsApp</WhatsAppPill>
            ) : (
              <PillLink href="/contact">Ask us directly</PillLink>
            )}
            <PillLink href="/coverage" variant="ink">
              Check coverage
            </PillLink>
          </>
        }
      >
        <p>
          The questions we actually get asked, answered the way we answer them
          on WhatsApp.
        </p>
      </PageHeader>

      <div className="mx-auto max-w-3xl px-4 py-14">
        {SECTIONS.map((section, index) => (
          <section key={section.title} className={index === 0 ? "" : "mt-12"}>
            <h2 className="text-xl font-semibold tracking-tight">
              {section.title}
            </h2>
            <dl className="mt-5 space-y-3">
              {section.faqs.map((f, i) => (
                <Reveal
                  key={f.q}
                  delay={Math.min(i, 4) * 0.05}
                  className="rounded-2xl border bg-card p-5"
                >
                  <dt className="font-semibold">{f.q}</dt>
                  <dd className="mt-1.5 text-sm leading-6 text-foreground/80">
                    {f.a}
                  </dd>
                </Reveal>
              ))}
            </dl>
          </section>
        ))}

        <div className="mt-12 flex flex-wrap items-center gap-4 rounded-3xl border bg-card p-6">
          <p className="flex-1 text-sm leading-6 text-foreground/80">
            Still stuck? Ask us directly and a real person answers. Existing
            customers get the fastest help from{" "}
            <Link
              href="/portal/help"
              className="font-medium text-primary hover:underline"
            >
              inside the portal
            </Link>
            .
          </p>
          <PillLink href="/contact" variant="outline">
            Contact us
          </PillLink>
        </div>
      </div>
    </>
  );
}
