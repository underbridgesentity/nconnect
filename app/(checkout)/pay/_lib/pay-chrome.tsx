import Link from "next/link";

import {
  whatsappHref as companyWhatsappHref,
  type CompanySettings,
} from "@/components/public/whatsapp";

/**
 * Shared furniture for the public pay-link surfaces (spec §6.2/§6.3).
 *
 * Both the pay page and the outcome page arrive by SMS or WhatsApp, so they
 * have to offer a human route out. The registered company details sit in the
 * checkout layout, which wraps every one of these screens.
 */

export type Company = CompanySettings;

export const CTA =
  "flex w-full touch-target items-center justify-center rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 hover:bg-[#0f5a91]";

export const CTA_SECONDARY =
  "inline-flex touch-target items-center justify-center rounded-full border px-6 text-sm font-medium hover:bg-accent";

/**
 * wa.me link for the support number, or null when settings carry no
 * WhatsApp-capable mobile. The company switchboard is an 086 share-call
 * number that wa.me refuses, so deriving the link from `company.phone`
 * produced "phone number shared via url is invalid" on a payment page, which
 * is worse than offering no WhatsApp at all.
 */
export function whatsappHref(
  company: Company | null | undefined,
  message?: string
): string | null {
  return companyWhatsappHref(company, message);
}

/** No token, a bad token, or an invoice we cannot find behind one. */
export function ExpiredLink({ company }: { company: Company | null }) {
  const wa = whatsappHref(
    company,
    "Hi Needd Connect, my payment link has expired, please send me a new one."
  );
  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">This payment link has expired</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Pay links are single-invoice and time-limited for your safety. Sign in
        to your portal to see and pay everything outstanding, or ask us for a
        fresh link.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link href="/login" className={CTA}>
          Sign in to your portal
        </Link>
        {wa ? (
          <a href={wa} className={CTA_SECONDARY}>
            WhatsApp us for a new link
          </a>
        ) : null}
      </div>
    </div>
  );
}
