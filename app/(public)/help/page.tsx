import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/public/json-ld";

export const metadata: Metadata = {
  title: "Help & FAQ",
  description:
    "Answers on coverage, billing, RICA, activation times, suspensions and cancellations at Needd Connect.",
  alternates: { canonical: "/help" },
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
        a: "For MTN/Vodacom LTE and 5G, yes — the router must be network-approved, and we sell approved models. Telkom LTE works with any LTE-compatible device. Fibre routers connect to the operator's equipment; ours are pre-configured.",
      },
      {
        q: "How long until I'm online?",
        a: "LTE/5G: hardware delivery within 3 business days, then instant activation — allow up to 24 hours for the data allocation to reflect. Fibre: depends on whether your address needs an installation; we tell you the timeline before you commit.",
      },
    ],
  },
  {
    title: "RICA and paperwork",
    faqs: [
      {
        q: "Why do you need my ID and proof of address?",
        a: "RICA — South African law — requires it for any SIM-based service. You upload both during signup. We store them encrypted, use them only for RICA verification, and retain them only as long as the law requires.",
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
        a: "You pay your first month (plus hardware and once-off fees) at checkout. After activation, your monthly invoice lands on the same date each month — the date your service went live, not the date you ordered.",
      },
      {
        q: "What payment methods do you accept?",
        a: "Card payments via PayFast, with the option to save your card for automatic monthly billing. EFT works too — your invoice carries the banking details and reference.",
      },
      {
        q: "What happens if a payment fails?",
        a: "We retry your card and remind you on WhatsApp and email. If an invoice is 10 days overdue the service is suspended — pay the outstanding invoice and it reactivates automatically. We'd rather warn you early than surprise you.",
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
        a: "In your portal, under the service. Month-to-month services cancel at the end of the current billing period. We'll ask once if a cheaper plan or a support conversation would fix the issue — one screen, not a retention marathon.",
      },
    ],
  },
];

export default function HelpPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
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
      <h1 className="text-3xl font-semibold tracking-tight">Help & FAQ</h1>
      <p className="mt-2 text-muted-foreground">
        Straight answers. If yours isn&apos;t here,{" "}
        <Link href="/contact" className="text-primary hover:underline">
          ask us directly
        </Link>
        .
      </p>
      {SECTIONS.map((section) => (
        <section key={section.title} className="mt-10">
          <h2 className="text-xl font-semibold">{section.title}</h2>
          <dl className="mt-4 space-y-5">
            {section.faqs.map((f) => (
              <div key={f.q}>
                <dt className="font-medium">{f.q}</dt>
                <dd className="mt-1 text-sm text-muted-foreground">{f.a}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
