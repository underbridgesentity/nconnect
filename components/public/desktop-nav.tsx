"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { PRIMARY_NAV, isActiveRoute } from "@/components/public/nav-items";

/**
 * Desktop section links with an active-route pill (mirrors app/admin/nav.tsx).
 *
 * The pill is not decoration: aria-current="page" tells a screen reader which
 * of seven sections the visitor is standing in, which the old header never
 * said. Padding tightens at lg and relaxes at xl so all seven labels plus the
 * logo, Sign in and the CTA still fit on a 1024px viewport without wrapping.
 */
export function DesktopNav() {
  const pathname = usePathname();
  return (
    <nav
      className="hidden min-w-0 items-center gap-0.5 lg:flex xl:gap-1"
      aria-label="Main navigation"
    >
      {PRIMARY_NAV.map((item) => {
        const active = isActiveRoute(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "whitespace-nowrap rounded-full px-2.5 py-2 text-sm font-medium transition-colors xl:px-3.5",
              active
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
