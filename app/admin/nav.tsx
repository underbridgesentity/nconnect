"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ListTodo,
  Users,
  Package,
  Receipt,
  Inbox,
  BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/admin", label: "Today", short: "Today", icon: ListTodo },
  {
    href: "/admin/customers",
    label: "Customers",
    short: "Customers",
    icon: Users,
  },
  {
    href: "/admin/catalogue",
    label: "Catalogue",
    short: "Catalogue",
    icon: Package,
  },
  { href: "/admin/billing", label: "Billing", short: "Billing", icon: Receipt },
  { href: "/admin/inbox", label: "Inbox", short: "Inbox", icon: Inbox },
  {
    href: "/admin/reports",
    label: "Reports & Settings",
    // The tab bar shows "Reports" so six labels fit at 390px. The visible
    // text is the accessible name on both surfaces, and it is a prefix of
    // the sidebar's, so the two never contradict each other.
    short: "Reports",
    icon: BarChart3,
  },
];

function isActive(pathname: string, href: string) {
  return href === "/admin"
    ? pathname === "/admin"
    : pathname === href || pathname.startsWith(`${href}/`);
}

/** Ink-sidebar nav with active-route pills (desktop). */
export function AdminSidebarNav() {
  const pathname = usePathname();
  return (
    <nav className="flex-1 space-y-1 p-3">
      {NAV.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-white/10 text-white"
                : "text-white/60 hover:bg-white/5 hover:text-white"
            )}
          >
            <item.icon
              className={cn("size-4", active && "text-sky-400")}
              aria-hidden
            />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Labelled bottom tab bar for the 390px admin experience, the same shape the
 * customer portal ships.
 *
 * It used to be six unlabelled icons in a scrolling top strip: a receipt and
 * a bar chart tell you nothing about "Billing" and "Reports & Settings", the
 * names were `sr-only` so only a screen reader ever got them, and the sixth
 * icon sat off the right edge behind a horizontal scroll nobody discovers.
 *
 * Six labels do fit once the bar spans the full width instead of sharing a
 * 390px row with the bell and the sign-out button: 62px a tab, and the widest
 * label ("Customers") measures 53px at 10px in Plus Jakarta Sans, so it still
 * clears a 360px phone. The labels truncate rather than widen, and the 44px
 * touch floor is a min-width rather than a width, so the row can never scroll
 * sideways however large the user has set their text.
 *
 * The 56px height comes from padding, not from `min-h-[56px]`. `.touch-target`
 * is declared last in the utilities layer, so its `min-height: 44px` wins over
 * any min-height utility on the same element and a min-height here would
 * silently render 44px instead. Padding is added to the content box, so it
 * lands where it is meant to.
 */
export function AdminMobileNav() {
  const pathname = usePathname();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-10 px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] md:hidden"
      aria-label="Admin sections"
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
                "flex flex-1 touch-target flex-col items-center justify-center gap-0.5 rounded-2xl py-2.5 text-[10px] font-medium transition-colors",
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
              <span className="w-full truncate leading-none">{item.short}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
