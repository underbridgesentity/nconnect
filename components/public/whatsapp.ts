/**
 * WhatsApp entry points.
 *
 * wa.me only resolves real mobile numbers. The company switchboard seeded in
 * settings is 086 686 3078, a share-call prefix, so deriving a WhatsApp link
 * from `company.phone` produced a link that opened "phone number shared via
 * url is invalid". WhatsApp is the headline support promise on this site, so
 * a broken link is worse than no link: we only render the affordance when
 * settings carry a number that really is a South African mobile.
 *
 * Set `company.whatsapp` in settings (E.164 "27821234567", or the local
 * "082 123 4567") to switch the WhatsApp buttons on across the public site.
 */

export type CompanySettings = {
  legalName?: string;
  website?: string;
  phone?: string;
  /** Mobile number that can actually receive WhatsApp. */
  whatsapp?: string;
  email?: string;
  vat?: string;
  reg?: string;
  bbbee?: string;
};

/**
 * SA mobile ranges: 06x, 07x and 081-084. Deliberately excludes 080
 * (toll-free), 086 (share-call) and 087 (geographic-independent VoIP),
 * none of which WhatsApp can deliver to.
 */
const SA_MOBILE = /^27(6\d|7\d|8[1-4])\d{7}$/;

/** Normalise a South African number to E.164 digits, or null if it is not a mobile. */
export function toMobileE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `27${digits.slice(1)}`;
  else if (digits.length === 9) digits = `27${digits}`;
  return SA_MOBILE.test(digits) ? digits : null;
}

/** The company WhatsApp number in E.164 digits, or null when none is configured. */
export function whatsappNumber(
  company: CompanySettings | null | undefined
): string | null {
  return (
    toMobileE164(company?.whatsapp) ?? toMobileE164(company?.phone) ?? null
  );
}

/**
 * A wa.me link, optionally pre-filled with the first message, or null when no
 * usable mobile is configured. Callers must render nothing when this is null.
 */
export function whatsappHref(
  company: CompanySettings | null | undefined,
  message?: string
): string | null {
  const number = whatsappNumber(company);
  if (!number) return null;
  const query = message ? `?text=${encodeURIComponent(message)}` : "";
  return `https://wa.me/${number}${query}`;
}

/** "082 123 4567" for display next to a WhatsApp link. */
export function formatMobile(e164: string): string {
  const national = e164.startsWith("27") ? `0${e164.slice(2)}` : e164;
  return national.replace(/^(\d{3})(\d{3})(\d{4})$/, "$1 $2 $3");
}
