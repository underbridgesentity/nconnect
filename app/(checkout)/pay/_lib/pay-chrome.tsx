import {
  whatsappHref as companyWhatsappHref,
  type CompanySettings,
} from "@/components/public/whatsapp";
import { PillLink, pillClass } from "@/components/public/pill";

/**
 * Shared furniture for the public pay-link surfaces (spec §6.2/§6.3).
 *
 * Both the pay page and the outcome page arrive by SMS or WhatsApp, so they
 * have to offer a human route out. The registered company details sit in the
 * checkout layout, which wraps every one of these screens.
 */

export type Company = CompanySettings;

/**
 * The pay surfaces' primary action: the platform pill
 * (components/public/pill.tsx), run full width because these screens are one
 * column on a phone and the thing to press should be unmissable. A class
 * string rather than a component because the pay button is a PendingSubmit,
 * which takes a className. Secondary actions use `<PillLink variant="outline">`
 * directly; there is no second constant to keep in step.
 */
export const CTA = pillClass("primary", { className: "flex w-full" });

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
        <PillLink href="/login" className="flex w-full">
          Sign in to your portal
        </PillLink>
        {wa ? (
          <PillLink href={wa} variant="outline">
            WhatsApp us for a new link
          </PillLink>
        ) : null}
      </div>
    </div>
  );
}
