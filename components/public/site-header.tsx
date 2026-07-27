import Image from "next/image";
import Link from "next/link";
import { DesktopNav } from "@/components/public/desktop-nav";
import { MobileMenu } from "@/components/public/mobile-menu";
import { PRIMARY_NAV } from "@/components/public/nav-items";

/**
 * The public header: one 64px row at every width.
 *
 * Below lg the sections move into MobileMenu, so a 390px phone keeps its whole
 * viewport for the page instead of losing roughly 110px to a header plus a
 * scrolling pill strip. Above lg the seven sections show as pills with the
 * current one lit.
 *
 * All seven links are still in the server HTML at every width (the desktop nav
 * is hidden with CSS, not omitted), so crawlers and readers with no JavaScript
 * see the complete navigation.
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b bg-card/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
        <Link href="/" aria-label="Needd Connect home" className="shrink-0">
          <Image
            src="/brand/logo-dark.png"
            alt="Needd Connect"
            width={140}
            height={21}
            priority
            className="h-[19px] w-auto sm:h-[21px]"
          />
        </Link>

        <DesktopNav />

        <div className="flex shrink-0 items-center gap-1.5">
          <Link
            href="/login"
            className="touch-target hidden items-center whitespace-nowrap rounded-full px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground lg:flex xl:px-3"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="touch-target flex items-center whitespace-nowrap rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-md shadow-primary/20 transition-colors hover:bg-[#0f5a91] xl:px-5"
          >
            Get connected
          </Link>
          <MobileMenu />
        </div>
      </div>

      <NoScriptNav />
    </header>
  );
}

/**
 * Plain wrapped links for a narrow viewport with scripting turned off, where
 * the menu button cannot open anything. Gated the same way as `.reveal` in
 * globals.css, so browsers that do run scripts never render it.
 */
function NoScriptNav() {
  return (
    <nav
      aria-label="Site sections"
      className="hidden border-t px-4 py-2.5 max-lg:[@media(scripting:none)]:block"
    >
      <ul className="flex flex-wrap gap-x-1 gap-y-1.5">
        {PRIMARY_NAV.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="flex min-h-9 items-center rounded-full px-3 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              {item.label}
            </Link>
          </li>
        ))}
        <li>
          <Link
            href="/login"
            className="flex min-h-9 items-center rounded-full px-3 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            Sign in
          </Link>
        </li>
      </ul>
    </nav>
  );
}
