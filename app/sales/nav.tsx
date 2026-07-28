"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, ContactRound, FileText, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/sales", label: "Home", icon: LayoutDashboard },
  { href: "/sales/leads", label: "Leads", icon: ContactRound },
  { href: "/sales/quotes", label: "Quotes", icon: FileText },
  { href: "/sales/customers", label: "My customers", icon: Users },
];

function isActive(pathname: string, href: string) {
  return href === "/sales"
    ? pathname === "/sales"
    : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Sales header nav pills with an active-route state, from sm upwards.
 *
 * Below sm it is gone entirely and the bottom tab bar takes over, so the two
 * are never both in the accessibility tree and can share a name.
 */
export function SalesNav() {
  const pathname = usePathname();
  return (
    <nav className="hidden items-center gap-1 sm:flex" aria-label="Sales sections">
      {NAV.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex touch-target items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            <item.icon className="size-4" aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Labelled bottom tab bar for a phone, the shape admin and the portal ship.
 *
 * The four links used to be icons with `sr-only` labels, squeezed into a
 * 390px header beside the logo, the bell and the sign-out button. A contact
 * card and a sheet of paper do not say "Leads" and "Quotes", and a rep in a
 * customer's driveway was picking between four unlabelled glyphs with a thumb.
 *
 * Four labels fit easily once the bar has the full width: 86px a tab at 360px,
 * and "My customers" measures about 70px at 11px in Plus Jakarta Sans, so the
 * full label survives and the tab bar says the same thing the header does. The
 * labels truncate rather than widen, and the 44px floor is a min-width, so the
 * row cannot scroll sideways however large the user has set their text.
 *
 * Height comes from padding, not `min-h-*`: `.touch-target` sets min-height in
 * the same cascade layer, so a min-height utility here would be discarded. Ask
 * for extra height with `--touch-h` if it is ever needed.
 */
export function SalesMobileNav() {
  const pathname = usePathname();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-10 px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] sm:hidden"
      aria-label="Sales sections"
    >
      <div className="mx-auto flex max-w-lg items-stretch justify-around rounded-2xl border bg-card/95 shadow-lg shadow-black/10 backdrop-blur">
        {NAV.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-1 touch-target flex-col items-center justify-center gap-0.5 rounded-2xl py-2.5 text-[11px] font-medium transition-colors",
                active
                  ? "text-primary"
                  : "text-muted-foreground hover:text-primary"
              )}
            >
              <span
                className={cn(
                  "flex h-6 w-9 items-center justify-center rounded-full transition-colors",
                  active && "bg-primary/10"
                )}
              >
                <item.icon className="size-5" aria-hidden />
              </span>
              <span className="w-full truncate px-0.5 text-center leading-none">
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
