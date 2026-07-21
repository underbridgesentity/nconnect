import Image from "next/image";
import Link from "next/link";
import { NotificationBell } from "@/components/shared/bell";
import { ServiceWorkerRegister } from "@/components/shared/sw-register";
import { PortalTabs } from "./tabs";

/** Customer portal shell: mobile-first with a thumb-reachable bottom tab bar. */
export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col">
      <ServiceWorkerRegister />
      <header className="sticky top-0 z-10 flex h-14 items-center justify-center border-b bg-card/95 backdrop-blur">
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
      <main className="flex-1 p-4 pb-32">{children}</main>
      <PortalTabs />
    </div>
  );
}
