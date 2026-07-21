"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Receipt, LifeBuoy, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/portal", label: "Home", icon: Home },
  { href: "/portal/billing", label: "Billing", icon: Receipt },
  { href: "/portal/help", label: "Help", icon: LifeBuoy },
  { href: "/portal/account", label: "Account", icon: UserRound },
];

function isActive(pathname: string, href: string) {
  return href === "/portal"
    ? pathname === "/portal"
    : pathname === href || pathname.startsWith(`${href}/`);
}

/** Floating pill tab bar, thumb-reachable, with an active-route state. */
export function PortalTabs() {
  const pathname = usePathname();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-10 px-4 pb-[max(env(safe-area-inset-bottom),1rem)]"
      aria-label="Portal navigation"
    >
      <div className="mx-auto flex max-w-lg items-stretch justify-around rounded-full border bg-card/95 shadow-lg shadow-black/10 backdrop-blur">
        {TABS.map((tab) => {
          const active = isActive(pathname, tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-[56px] flex-1 touch-target flex-col items-center justify-center gap-0.5 rounded-full text-xs font-medium transition-colors",
                active
                  ? "text-primary"
                  : "text-muted-foreground hover:text-primary"
              )}
            >
              <span
                className={cn(
                  "flex h-6 w-10 items-center justify-center rounded-full transition-colors",
                  active && "bg-primary/10"
                )}
              >
                <tab.icon className="size-5" aria-hidden />
              </span>
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
