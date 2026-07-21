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

/** Sales header nav pills with an active-route state. */
export function SalesNav() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-1">
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
            <span className="hidden sm:inline">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
