import type { Metadata } from "next";
import { PageHeader } from "@/components/public/page-header";
import { Prose } from "@/components/public/prose";
import { LegalNav } from "@/components/public/legal-nav";
import { PillLink } from "@/components/public/pill";

export const metadata: Metadata = {
  title: "RICA Information",
  description:
    "What RICA is, what documents you need, and how Needd Connect handles your RICA information.",
  alternates: { canonical: "/legal/rica" },
  openGraph: {
    title: "RICA Information | Needd Connect",
    description:
      "What RICA is, what documents you need, and how we handle them.",
    url: "/legal/rica",
    type: "website",
  },
};

export default function RicaPage() {
  return (
    <>
      <PageHeader size="compact" eyebrow="Legal" title="RICA information">
        <p>
          Every SIM in South Africa must be registered to an identified person.
          Here is exactly what that means for you.
        </p>
      </PageHeader>

      <div className="mx-auto max-w-3xl px-4 py-14">
        <Prose>
          <section>
            <h2>What RICA is</h2>
            <p>
              The Regulation of Interception of Communications and Provision of
              Communication-related Information Act requires every SIM card in
              South Africa to be registered to an identified person. It applies
              to our LTE, 5G and SIM data services, not to fibre or VoIP
              without a SIM.
            </p>
          </section>
          <section>
            <h2>What you need</h2>
            <ul>
              <li>Your full name and SA ID or passport number</li>
              <li>A photo of your ID document or passport</li>
              <li>
                Proof of your residential address no older than 3 months (bank
                statement, municipal bill or lease)
              </li>
            </ul>
            <p className="mt-4">
              You upload these during signup, a clear phone photo is fine. Your
              service activates only once we have verified them, which we do
              within one business day.
            </p>
          </section>
          <section>
            <h2>How we protect it</h2>
            <p>
              RICA documents are stored in private, encrypted storage in South
              Africa; ID numbers are additionally encrypted and masked in our
              systems. Access is limited to verification staff and every access
              is logged. RICA law requires us to retain these records for 5
              years after your service ends, they are excluded from deletion
              requests for that period.
            </p>
          </section>
        </Prose>

        <div className="mt-10 flex flex-wrap items-center gap-4 rounded-3xl border bg-card p-6">
          <p className="flex-1 text-sm leading-6 text-foreground/80">
            Ready to sign up? Have your ID and a recent proof of address on
            your phone, it takes about two minutes.
          </p>
          <PillLink href="/coverage" variant="outline">
            Check coverage first
          </PillLink>
        </div>

        <LegalNav current="/legal/rica" />
      </div>
    </>
  );
}
