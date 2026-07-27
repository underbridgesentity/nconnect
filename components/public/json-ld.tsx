import type { CompanySettings } from "@/components/public/whatsapp";

/** Renders a JSON-LD script tag. Data is app-generated, never user input. */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

/**
 * Cents to the decimal string schema.org expects ("33100" -> "331.00").
 * Integer maths only: money never goes near a float (house rule).
 */
export function priceString(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

const SELLER = { "@type": "Organization", name: "Needd Connect" } as const;

/** A schema.org Offer with the seller and currency filled in consistently. */
export function offerJsonLd({
  appUrl,
  path,
  priceCents,
  inStock = true,
  priceValidUntil,
}: {
  appUrl: string;
  path: string;
  priceCents: number;
  inStock?: boolean;
  priceValidUntil?: string;
}) {
  return {
    "@type": "Offer",
    price: priceString(priceCents),
    priceCurrency: "ZAR",
    availability: inStock
      ? "https://schema.org/InStock"
      : "https://schema.org/PreOrder",
    url: `${appUrl}${path}`,
    seller: SELLER,
    ...(priceValidUntil ? { priceValidUntil } : {}),
  };
}

/**
 * BreadcrumbList to match the visual breadcrumb every detail page renders,
 * so search results show the trail instead of a bare URL.
 */
export function breadcrumbJsonLd(
  appUrl: string,
  items: { name: string; path?: string }[]
) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      ...(item.path ? { item: `${appUrl}${item.path}` } : {}),
    })),
  };
}

/**
 * Organisation graph. Contact details come from the company setting when it
 * is available so the knowledge panel can never drift from what the site
 * actually shows; nothing is invented when a field is unset.
 */
export function organizationJsonLd(
  appUrl: string,
  company?: CompanySettings | null
) {
  const telephone = company?.phone
    ? `+27${company.phone.replace(/\D/g, "").replace(/^0/, "")}`
    : "+27866863078";
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Needd Connect",
    legalName: company?.legalName ?? "Needd Technology Solutions (Pty) Ltd",
    url: appUrl,
    logo: `${appUrl}/brand/icon-512.png`,
    areaServed: "ZA",
    address: { "@type": "PostalAddress", addressCountry: "ZA" },
    ...(company?.vat ? { vatID: company.vat } : {}),
    contactPoint: {
      "@type": "ContactPoint",
      telephone,
      ...(company?.email ? { email: company.email } : {}),
      contactType: "customer service",
      areaServed: "ZA",
      availableLanguage: "en",
    },
  };
}
