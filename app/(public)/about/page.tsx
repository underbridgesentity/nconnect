import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About",
  description:
    "Needd Connect is a South African connectivity reseller: accredited with the major networks and fibre operators, selling under one bill with local support.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">About Needd Connect</h1>
      <div className="prose-sm mt-6 space-y-4 text-muted-foreground">
        <p>
          Needd Connect is the connectivity brand of Needd Technology Solutions
          (Pty) Ltd, a South African company (est. 2014, B-BBEE Level 1). We
          are an accredited reseller of MTN, Vodacom and Telkom services, with
          fibre delivered over Openserve, Vumatel, Frogfoot and MetroFibre.
        </p>
        <p>
          Being a reseller is the point, not a compromise. We buy wholesale
          from the networks and sell to you directly — which means you never
          phone a network call centre again. One provider, one bill, and
          support from people who know your account, on WhatsApp.
        </p>
        <p>
          We keep our promises deliberately small and keep them: honest
          coverage answers, plain-language fair-usage policies, invoices on
          your activation date, and a portal where cancelling doesn&apos;t
          require a phone call.
        </p>
      </div>
      <div className="mt-8 flex gap-3">
        <Link
          href="/coverage"
          className="flex touch-target items-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Check your coverage
        </Link>
        <Link
          href="/contact"
          className="flex touch-target items-center rounded-md border px-5 text-sm font-medium hover:bg-accent"
        >
          Talk to us
        </Link>
      </div>
    </div>
  );
}
