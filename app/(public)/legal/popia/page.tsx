import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/public/page-header";
import { Prose } from "@/components/public/prose";
import { LegalNav } from "@/components/public/legal-nav";

export const metadata: Metadata = {
  title: "POPIA Notice",
  description:
    "Needd Connect's processing notice under the Protection of Personal Information Act.",
  alternates: { canonical: "/legal/popia" },
  openGraph: {
    title: "POPIA Notice | Needd Connect",
    description:
      "Our processing notice under the Protection of Personal Information Act.",
    url: "/legal/popia",
    type: "website",
  },
};

export default function PopiaPage() {
  return (
    <>
      <PageHeader size="compact" eyebrow="Legal" title="POPIA notice">
        <p>
          Our processing notice under the Protection of Personal Information
          Act: what we process, on what grounds, and who to contact.
        </p>
      </PageHeader>

      <div className="mx-auto max-w-3xl px-4 py-14">
        <Prose flow="flow">
          <p>
            Needd Technology Solutions (Pty) Ltd is the responsible party for
            personal information processed through Needd Connect. We process
            personal information to conclude and perform service agreements, to
            bill and collect, to meet legal obligations (including RICA and tax
            law), and, only with your separate opt-in, for marketing.
          </p>
          <p>
            Processing is grounded in: performance of a contract (your
            service), legal obligation (RICA, tax), and consent (marketing).
            You may withdraw marketing consent at any time in your portal
            without affecting your service.
          </p>
          <p>
            Information officer: the directors of Needd Technology Solutions
            (Pty) Ltd, reachable at info@needd.co.za. Data subject requests are
            handled per the process in our{" "}
            <Link href="/legal/privacy">Privacy Policy</Link>.
          </p>
          <p>
            Data is stored in South Africa (Cape Town region). Where a network
            operator or payment processor must receive personal information to
            deliver your service, we share only the minimum required.
          </p>
        </Prose>
        <LegalNav current="/legal/popia" />
      </div>
    </>
  );
}
