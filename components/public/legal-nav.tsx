import Link from "next/link";

/**
 * The four policy documents cross-link, so a reader who lands on one from a
 * search result can find the rest without going back to the footer.
 */
const DOCS = [
  { href: "/legal/terms", label: "Terms of Service" },
  { href: "/legal/privacy", label: "Privacy Policy" },
  { href: "/legal/rica", label: "RICA information" },
  { href: "/legal/popia", label: "POPIA notice" },
];

export function LegalNav({ current }: { current: string }) {
  const others = DOCS.filter((doc) => doc.href !== current);
  return (
    <nav aria-label="Other policies" className="mt-12 border-t pt-8">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        The other documents
      </h2>
      <ul className="mt-4 flex flex-wrap gap-2.5">
        {others.map((doc) => (
          <li key={doc.href}>
            <Link
              href={doc.href}
              className="inline-flex min-h-10 items-center rounded-full border bg-card px-4 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              {doc.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
