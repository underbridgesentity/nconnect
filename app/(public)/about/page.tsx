import type { Metadata } from "next";
import { getSetting, getSettingForDisplay } from "@/lib/domain/settings";
import { PageHeader, type HeaderStat } from "@/components/public/page-header";
import { PillLink } from "@/components/public/pill";
import { Prose } from "@/components/public/prose";
import type { CompanySettings } from "@/components/public/whatsapp";

export const metadata: Metadata = {
  title: "About",
  description:
    "Needd Connect is a South African connectivity reseller: accredited with the major networks and fibre operators, selling under one bill with local support.",
  alternates: { canonical: "/about" },
  openGraph: {
    title: "About | Needd Connect",
    description:
      "A South African connectivity reseller, accredited with the major networks and fibre operators. One provider, one bill, local support.",
    url: "/about",
    type: "website",
  },
};

export default async function AboutPage() {
  const company = await getSettingForDisplay<CompanySettings>("company");

  const stats: HeaderStat[] = [
    { label: "Established", value: <span className="tnum">2014</span> },
    ...(company?.bbbee ? [{ label: "Empowerment", value: company.bbbee }] : []),
    { label: "Billing", value: "One provider, one bill" },
  ];

  return (
    <>
      <PageHeader
        image="/marketing/support.webp"
        imageAlt="A support agent helping a customer over the phone"
        imagePosition="50% 30%"
        eyebrow="About"
        title="The middleman, done right"
        stats={stats}
        actions={
          <>
            <PillLink href="/coverage">Check your coverage</PillLink>
            <PillLink href="/contact" variant="ink">
              Talk to us
            </PillLink>
          </>
        }
      >
        <p>
          {company?.legalName ?? "Needd Technology Solutions (Pty) Ltd"}, a
          South African company selling connectivity the way we would want it
          sold to us.
        </p>
      </PageHeader>

      <div className="mx-auto max-w-5xl px-4 py-14">
        <Prose flow="flow">
          <p>
            Needd Connect is the connectivity brand of Needd Technology
            Solutions (Pty) Ltd, a South African company (est. 2014, B-BBEE
            Level 1). We are an accredited reseller of MTN, Vodacom and Telkom
            services, with fibre delivered over Openserve, Vumatel, Frogfoot
            and MetroFibre.
          </p>
          <p>
            Being a reseller is the point, not a compromise. We buy wholesale
            from the networks and sell to you directly, which means you never
            phone a network call centre again. One provider, one bill, and
            support from people who know your account, on WhatsApp.
          </p>
          <p>
            We keep our promises deliberately small and keep them: honest
            coverage answers, plain-language fair-usage policies, invoices on
            your activation date, and a portal where cancelling does not
            require a phone call.
          </p>
        </Prose>

        {company?.reg || company?.vat ? (
          <p className="mt-10 text-xs text-muted-foreground">
            {[
              company.legalName,
              company.reg ? `Reg ${company.reg}` : null,
              company.vat ? `VAT ${company.vat}` : null,
            ]
              .filter(Boolean)
              .join(" | ")}
          </p>
        ) : null}
      </div>
    </>
  );
}
