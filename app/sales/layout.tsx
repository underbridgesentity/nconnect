import Image from "next/image";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { SignOutButton } from "@/components/shared/sign-out-button";
import { NotificationBell } from "@/components/shared/bell";
import { SalesNav, SalesMobileNav } from "./nav";

export default async function SalesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b bg-card/95 px-3 backdrop-blur md:px-6">
        <div className="flex items-center gap-4">
          <Link href="/sales">
            <Image
              src="/brand/logo-dark.png"
              alt="Needd Connect"
              width={100}
              height={15}
              priority
            />
          </Link>
          <SalesNav />
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden truncate text-xs text-muted-foreground sm:inline">
            {session?.user?.name}
          </span>
          <NotificationBell />
          <SignOutButton compact />
        </div>
      </header>
      {/*
        Room for the bottom tab bar on a phone, so the last card on a page is
        never parked underneath it. From sm the bar is gone and so is the gap.
      */}
      <main
        id="main-content"
        className="mx-auto w-full max-w-5xl flex-1 p-4 pb-28 sm:pb-4 md:p-6"
      >
        {children}
      </main>
      <SalesMobileNav />
    </div>
  );
}
