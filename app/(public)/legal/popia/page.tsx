import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "POPIA Notice",
  description:
    "Needd Connect's processing notice under the Protection of Personal Information Act.",
  alternates: { canonical: "/legal/popia" },
};

export default function PopiaPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">POPIA Notice</h1>
      <div className="mt-6 space-y-4 text-sm leading-relaxed text-muted-foreground">
        <p>
          Needd Technology Solutions (Pty) Ltd is the responsible party for
          personal information processed through Needd Connect. We process
          personal information to conclude and perform service agreements, to
          bill and collect, to meet legal obligations (including RICA and tax
          law), and — only with your separate opt-in — for marketing.
        </p>
        <p>
          Processing is grounded in: performance of a contract (your service),
          legal obligation (RICA, tax), and consent (marketing). You may
          withdraw marketing consent at any time in your portal without
          affecting your service.
        </p>
        <p>
          Information officer: the directors of Needd Technology Solutions
          (Pty) Ltd, reachable at info@needd.co.za. Data subject requests are
          handled per the process in our{" "}
          <Link href="/legal/privacy" className="text-primary hover:underline">
            Privacy Policy
          </Link>
          .
        </p>
        <p>
          Data is stored in South Africa (Cape Town region). Where a network
          operator or payment processor must receive personal information to
          deliver your service, we share only the minimum required.
        </p>
      </div>
    </div>
  );
}
