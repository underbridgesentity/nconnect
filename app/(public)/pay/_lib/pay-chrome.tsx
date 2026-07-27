import Link from "next/link";

/**
 * Shared furniture for the public pay-link surfaces (spec §6.2/§6.3).
 *
 * Both the pay page and the outcome page arrive by SMS or WhatsApp, so they
 * have to look unmistakably like us and offer the same human route out:
 * legal name, registration, VAT and a way to reach a person.
 */

export type Company = {
  legalName: string;
  phone: string;
  email: string;
  vat: string;
  reg: string;
};

export const CTA =
  "flex w-full touch-target items-center justify-center rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 hover:bg-[#0f5a91]";

export const CTA_SECONDARY =
  "inline-flex touch-target items-center justify-center rounded-full border px-6 text-sm font-medium hover:bg-accent";

/** wa.me link for the support number, or null when no number is configured. */
export function whatsappHref(phone: string | null | undefined): string | null {
  if (!phone) return null;
  return `https://wa.me/27${phone.replace(/\D/g, "").replace(/^0/, "")}`;
}

export function CompanyLine({ company }: { company: Company | null }) {
  if (!company) return null;
  return (
    <p className="pt-1 text-xs text-muted-foreground">
      {company.legalName} | Reg {company.reg} | VAT {company.vat}
    </p>
  );
}

/** No token, a bad token, or an invoice we cannot find behind one. */
export function ExpiredLink({ company }: { company: Company | null }) {
  const wa = whatsappHref(company?.phone);
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
      <div className="mt-8">
        <CompanyLine company={company} />
      </div>
    </div>
  );
}
