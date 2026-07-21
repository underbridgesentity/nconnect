import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "RICA Information",
  description:
    "What RICA is, what documents you need, and how Needd Connect handles your RICA information.",
  alternates: { canonical: "/legal/rica" },
};

export default function RicaPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">RICA information</h1>
      <div className="mt-6 space-y-6 text-sm leading-relaxed text-muted-foreground [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-foreground">
        <section>
          <h2>What RICA is</h2>
          <p className="mt-2">
            The Regulation of Interception of Communications and Provision of
            Communication-related Information Act requires every SIM card in
            South Africa to be registered to an identified person. It applies
            to our LTE, 5G and SIM data services, not to fibre or VoIP
            without a SIM.
          </p>
        </section>
        <section>
          <h2>What you need</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Your full name and SA ID or passport number</li>
            <li>A photo of your ID document or passport</li>
            <li>
              Proof of your residential address no older than 3 months (bank
              statement, municipal bill or lease)
            </li>
          </ul>
          <p className="mt-2">
            You upload these during signup, a clear phone photo is fine. Your
            service activates only once we&apos;ve verified them, which we do
            within one business day.
          </p>
        </section>
        <section>
          <h2>How we protect it</h2>
          <p className="mt-2">
            RICA documents are stored in private, encrypted storage in South
            Africa; ID numbers are additionally encrypted and masked in our
            systems. Access is limited to verification staff and every access
            is logged. RICA law requires us to retain these records for 5
            years after your service ends, they are excluded from deletion
            requests for that period.
          </p>
        </section>
      </div>
    </div>
  );
}
