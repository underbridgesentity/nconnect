import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How Needd Connect collects, uses, stores and protects your personal information under POPIA.",
  alternates: { canonical: "/legal/privacy" },
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Privacy Policy</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Needd Technology Solutions (Pty) Ltd (Reg 2014/063733/07), last
        reviewed July 2026. Plain language on purpose.
      </p>

      <div className="mt-8 space-y-8 text-sm leading-relaxed text-muted-foreground [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-foreground">
        <section>
          <h2>What we collect, and why</h2>
          <p className="mt-2">
            We collect only what running your service requires: your name and
            contact details (to identify you and communicate), your service
            address (to deliver and provision connectivity), payment records
            (to bill you), and, for SIM-based services only, your ID number,
            ID document and proof of address, because RICA legally requires
            it. Every form on this site says why each field is collected.
          </p>
        </section>
        <section>
          <h2>Where your data lives</h2>
          <p className="mt-2">
            Our systems run in the af-south-1 (Cape Town) region: your data is
            stored in South Africa. Compliance documents are held in private,
            encrypted storage and are only accessible to authorised staff via
            expiring links; every access is logged.
          </p>
        </section>
        <section>
          <h2>ID numbers get extra protection</h2>
          <p className="mt-2">
            Your ID number is encrypted at the application layer (AES-256) and
            is masked everywhere except the RICA verification screen used by
            authorised staff.
          </p>
        </section>
        <section>
          <h2>Consent and marketing</h2>
          <p className="mt-2">
            Processing consent is captured explicitly at signup, with separate,
            unticked opt-ins for WhatsApp and email marketing. Transactional
            messages (invoices, service status) are part of running your
            service and don&apos;t depend on marketing consent. You can change
            marketing preferences in your portal at any time.
          </p>
        </section>
        <section>
          <h2>Retention</h2>
          <p className="mt-2">
            We keep financial records as tax law requires. RICA records, including your ID document and proof of address, are retained for
            5 years after your service ends, as RICA requires, and are excluded
            from deletion requests for that period.
          </p>
        </section>
        <section>
          <h2>Your rights</h2>
          <p className="mt-2">
            Under POPIA you may request access to, correction of, or deletion
            of your personal information (subject to the legal retention above).
            Use the &ldquo;Request my data&rdquo; button in your portal or
            email us; we confirm in writing and act on it. Complaints can also
            go to the Information Regulator (
            <a
              href="https://inforegulator.org.za"
              className="text-primary hover:underline"
            >
              inforegulator.org.za
            </a>
            ).
          </p>
        </section>
        <section>
          <h2>Who else sees your data</h2>
          <p className="mt-2">
            The minimum needed to deliver your service: the network or fibre
            operator provisioning your line, PayFast for payment processing,
            and our messaging providers for WhatsApp/email/SMS delivery. We
            never sell personal information.
          </p>
        </section>
      </div>
      <p className="mt-8 text-sm text-muted-foreground">
        See also the{" "}
        <Link href="/legal/popia" className="text-primary hover:underline">
          POPIA notice
        </Link>{" "}
        and{" "}
        <Link href="/legal/rica" className="text-primary hover:underline">
          RICA information
        </Link>
        .
      </p>
    </div>
  );
}
