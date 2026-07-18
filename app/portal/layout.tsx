import Image from "next/image";
import Link from "next/link";
import { Home, Receipt, LifeBuoy, UserRound } from "lucide-react";
import { NotificationBell } from "@/components/shared/bell";
import { ServiceWorkerRegister } from "@/components/shared/sw-register";

const TABS = [
  { href: "/portal", label: "Home", icon: Home },
  { href: "/portal/billing", label: "Billing", icon: Receipt },
  { href: "/portal/help", label: "Help", icon: LifeBuoy },
  { href: "/portal/account", label: "Account", icon: UserRound },
];

/** Customer portal shell: mobile-first with a thumb-reachable bottom tab bar. */
export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col">
      <ServiceWorkerRegister />
      <header className="relative flex h-14 items-center justify-center border-b bg-card">
        <Link href="/portal">
          <Image
            src="/brand/logo-dark.png"
            alt="Needd Connect"
            width={110}
            height={16}
            priority
          />
        </Link>
        <span className="absolute right-2">
          <NotificationBell />
        </span>
      </header>
      <main className="flex-1 p-4 pb-24">{children}</main>
      <nav
        className="fixed inset-x-0 bottom-0 z-10 border-t bg-card pb-[env(safe-area-inset-bottom)]"
        aria-label="Portal navigation"
      >
        <div className="mx-auto flex max-w-lg items-stretch justify-around">
          {TABS.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className="flex min-h-[56px] flex-1 touch-target flex-col items-center justify-center gap-0.5 text-xs font-medium text-muted-foreground hover:text-primary"
            >
              <tab.icon className="size-5" aria-hidden />
              {tab.label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
