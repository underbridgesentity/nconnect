import type { Metadata } from "next";
import Image from "next/image";
import { Lock, MessageCircle, Phone } from "lucide-react";
import { getSettingForDisplay } from "@/lib/domain/settings";
import {
  whatsappHref,
  type CompanySettings,
} from "@/components/public/whatsapp";

/**
 * The checkout shell: /signup and /pay only.
 *
 * These routes used to sit inside the marketing group, so the last screen
 * before a payment carried a sticky header with a hamburger opening every
 * section of the site, a competing "Get connected" call to action, and the
 * full footer. On a 390px phone that is a page of exits wrapped around the
 * one thing the customer came to do.
 *
 * What survives is what a payment page owes the payer: the brand mark, so the
 * page is recognisably us; a plain statement that the payment is taken
 * securely; a route to a person; and the registered company details. What goes
 * is every link that leads away from the purchase. The step indicator stays
 * inside the wizard page itself, which is the only place that knows the step.
 *
 * Server rendered end to end, with its own skip link and main landmark because
 * this shell replaces the public one rather than nesting inside it.
 */

const DESCRIPTION =
  "Uncapped LTE, 5G, fibre and business VoIP across South Africa. One provider, one bill, real local support on WhatsApp.";

/**
 * The share card. It comes free to the marketing group from its
 * opengraph-image file; this group needs it spelled out, because pay links go
 * out by SMS and WhatsApp and a link with no card renders as a bare grey URL,
 * which reads as a scam to a South African consumer.
 */
export const metadata: Metadata = {
  openGraph: {
    type: "website",
    siteName: "Needd Connect",
    locale: "en_ZA",
    title: "Needd Connect, One provider, one bill, local support",
    description: DESCRIPTION,
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Needd Connect, one provider, one bill, local support",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Needd Connect, One provider, one bill, local support",
    description: DESCRIPTION,
    images: ["/opengraph-image"],
  },
};

/** Desktop density, the project's 44px floor under a finger. */
const SUPPORT_LINK =
  "inline-flex min-h-9 items-center gap-1.5 rounded-full font-medium text-foreground transition-colors hover:text-primary pointer-coarse:min-h-11";

export default async function CheckoutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Chrome only (legal name, support routes). A settings read that throws
  // must not take the checkout down with it: the wizard below can still
  // price and sell, and losing the support phone number is survivable.
  const company = await getSettingForDisplay<CompanySettings>("company");
  const wa = whatsappHref(
    company,
    "Hi Needd Connect, I need a hand finishing my order."
  );
  const phone = company?.phone ?? null;

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>

      {/* Brand mark only. Deliberately not a link: this is the checkout. */}
      <header className="border-b bg-card">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between gap-3 px-4">
          <Image
            src="/brand/logo-dark.png"
            alt="Needd Connect"
            width={140}
            height={21}
            priority
            className="h-[19px] w-auto sm:h-[21px]"
          />
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Lock className="size-3.5 text-primary" aria-hidden />
            Secure checkout
          </p>
        </div>
      </header>

      <main id="main-content" className="flex-1">
        {children}
      </main>

      <footer className="border-t bg-card">
        <div className="mx-auto max-w-2xl space-y-1 px-4 py-5 pb-[max(env(safe-area-inset-bottom),1.25rem)] text-xs text-muted-foreground">
          {wa || phone ? (
            <p className="flex flex-wrap items-center gap-x-4">
              <span>Stuck? A person will finish this with you.</span>
              {wa ? (
                <a
                  href={wa}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={SUPPORT_LINK}
                >
                  <MessageCircle className="size-3.5" aria-hidden />
                  WhatsApp us
                  <span className="sr-only"> (opens WhatsApp in a new tab)</span>
                </a>
              ) : null}
              {phone ? (
                <a
                  href={`tel:${phone.replace(/\s/g, "")}`}
                  className={SUPPORT_LINK}
                >
                  <Phone className="size-3.5" aria-hidden />
                  {phone}
                </a>
              ) : null}
            </p>
          ) : null}
          {/* Only ever what settings actually carry, never a placeholder. */}
          {company?.legalName ? (
            <p>
              {company.legalName}
              {company.reg ? ` | Reg ${company.reg}` : ""}
              {company.vat ? ` | VAT ${company.vat}` : ""}
            </p>
          ) : null}
        </div>
      </footer>
    </div>
  );
}
