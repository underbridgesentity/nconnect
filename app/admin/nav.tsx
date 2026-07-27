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
  { href: "/admin", label: "Today", icon: ListTodo },
  { href: "/admin/customers", label: "Customers", icon: Users },
  { href: "/admin/catalogue", label: "Catalogue", icon: Package },
  { href: "/admin/billing", label: "Billing", icon: Receipt },
  { href: "/admin/inbox", label: "Inbox", icon: Inbox },
  { href: "/admin/reports", label: "Reports & Settings", icon: BarChart3 },
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
 * Icon-only top nav for the 390px admin experience.
 *
 * The name lives on the link, not on the svg: a bare `<svg aria-label>` has
 * no reliably nameable role, so every mobile nav link announced as an
 * unnamed link. `sr-only` keeps the text in the accessibility tree while
 * the icon carries the visual meaning.
 */
export function AdminMobileNav() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-1" aria-label="Admin sections">
      {NAV.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex touch-target items-center rounded-full px-2 text-xs font-medium transition-colors",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            <item.icon className="size-4" aria-hidden />
            <span className="sr-only">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
