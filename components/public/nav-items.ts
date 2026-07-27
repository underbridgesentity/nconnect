/**
 * One source of truth for public site navigation.
 *
 * The header (desktop pills), the mobile sheet and the footer all read these
 * lists, so a new section can never appear in one place and go missing in
 * another. Plain data with no server-only imports, so client and server
 * components can both use it.
 */

export type NavItem = { href: string; label: string };

/** Product sections, in header order. */
export const PRIMARY_NAV: NavItem[] = [
  { href: "/internet", label: "Home Internet" },
  { href: "/fibre", label: "Fibre" },
  { href: "/voip", label: "Business VoIP" },
  { href: "/sim-data", label: "SIM Data" },
  { href: "/hardware", label: "Hardware" },
  { href: "/bundles", label: "Bundles" },
  { href: "/coverage", label: "Coverage" },
];

/** Everything a visitor might want that is not a product. */
export const COMPANY_NAV: NavItem[] = [
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
  { href: "/help", label: "Help & FAQ" },
  { href: "/blog", label: "Blog" },
];

/** Labels match components/public/legal-nav.tsx so the four documents read the same everywhere. */
export const LEGAL_NAV: NavItem[] = [
  { href: "/legal/terms", label: "Terms of Service" },
  { href: "/legal/privacy", label: "Privacy Policy" },
  { href: "/legal/rica", label: "RICA information" },
  { href: "/legal/popia", label: "POPIA notice" },
];

/**
 * Active when the visitor is on the section index or anywhere beneath it, so
 * /hardware/rb-hap-ax2 keeps the Hardware pill lit. Mirrors the same helper in
 * app/admin/nav.tsx; no public nav item is a bare "/" so no root special case
 * is needed.
 */
export function isActiveRoute(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
