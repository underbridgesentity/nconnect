import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "The terms that govern Needd Connect services: billing, fair usage, suspension, cancellation and hardware.",
  alternates: { canonical: "/legal/terms" },
};

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Terms of Service</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Last reviewed July 2026. These terms are deliberately short and in
        plain language; the legal meaning is exactly what they say.
      </p>
      <div className="mt-8 space-y-8 text-sm leading-relaxed text-muted-foreground [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-foreground">
        <section>
          <h2>1. Who you&apos;re contracting with</h2>
          <p className="mt-2">
            Your agreement is with Needd Technology Solutions (Pty) Ltd (Reg
            2014/063733/07), trading as Needd Connect. We resell connectivity
            from licensed South African networks and fibre operators; the
            service relationship, billing and support are with us.
          </p>
        </section>
        <section>
          <h2>2. Billing</h2>
          <p className="mt-2">
            You pay your first month, hardware and once-off fees at checkout.
            Monthly billing starts from activation and recurs on your
            activation date. Invoices are due within 7 days. Prices are in
            Rands including VAT where applicable; price changes are announced
            at least one billing cycle ahead.
          </p>
        </section>
        <section>
          <h2>3. Fair usage</h2>
          <p className="mt-2">
            Uncapped services carry the fair-usage policy stated on the plan
            page, the exact allocations and step-down speeds you saw when you
            signed up. We don&apos;t change a plan&apos;s FUP mid-cycle.
          </p>
        </section>
        <section>
          <h2>4. Failed payment and suspension</h2>
          <p className="mt-2">
            If payment fails we retry and notify you. Invoices unpaid 10 days
            after issue lead to suspension; settling the outstanding amount
            reactivates the service automatically. We may charge a reactivation
            fee only if published in advance.
          </p>
        </section>
        <section>
          <h2>5. Cancellation</h2>
          <p className="mt-2">
            Month-to-month services cancel from your portal, effective at the
            end of the current billing period. Fixed-term deals (shown on the
            plan, e.g. 24-month SIM data) run their term; early exit follows
            the Consumer Protection Act where it applies.
          </p>
        </section>
        <section>
          <h2>6. Hardware</h2>
          <p className="mt-2">
            Hardware is sold, not rented, and carries the manufacturer&apos;s
            warranty. Defective-on-arrival devices are replaced. Hardware
            bought for a service that fails feasibility is refunded in full.
          </p>
        </section>
        <section>
          <h2>7. Service quality</h2>
          <p className="mt-2">
            Wireless speeds depend on coverage and congestion at your location;
            fibre speeds on the operator&apos;s line. We state honest
            expectations before you buy and help troubleshoot when reality
            falls short, but radio physics is not negotiable, and we
            don&apos;t promise what we can&apos;t control.
          </p>
        </section>
        <section>
          <h2>8. RICA</h2>
          <p className="mt-2">
            SIM-based services activate only after RICA verification. Providing
            false RICA information is a criminal offence and grounds for
            immediate termination.
          </p>
        </section>
      </div>
    </div>
  );
}
