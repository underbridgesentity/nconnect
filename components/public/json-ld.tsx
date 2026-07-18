/** Renders a JSON-LD script tag. Data is app-generated, never user input. */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

export function organizationJsonLd(appUrl: string) {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Needd Connect",
    legalName: "Needd Technology Solutions (Pty) Ltd",
    url: appUrl,
    logo: `${appUrl}/brand/icon-512.png`,
    contactPoint: {
      "@type": "ContactPoint",
      telephone: "+27866863078",
      contactType: "customer service",
      areaServed: "ZA",
    },
  };
}
