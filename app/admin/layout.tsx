import Image from "next/image";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { SignOutButton } from "@/components/shared/sign-out-button";
import { NotificationBell } from "@/components/shared/bell";
import { AdminSidebarNav, AdminMobileNav } from "./nav";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  return (
    <div className="flex min-h-dvh w-full">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <aside
        data-surface="ink"
        className="hidden w-60 shrink-0 flex-col bg-[#121829] md:flex"
      >
        <div className="flex h-16 items-center px-5">
          <Link href="/admin">
            <Image
              src="/brand/logo-white.png"
              alt="Needd Connect"
              width={110}
              height={16}
              priority
            />
          </Link>
        </div>
        <AdminSidebarNav />
        <div className="flex items-center justify-between border-t border-white/10 p-3">
          <span className="truncate text-xs text-white/50">
            {session?.user?.name}
          </span>
          <span className="flex items-center gap-0.5">
            <NotificationBell tone="dark" />
            <SignOutButton compact tone="dark" />
          </span>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {/*
          Mobile top bar (admin is fully usable at 390px, spec §16.8). The
          sections moved to a labelled bottom tab bar, so this row is just
          identity plus the two account controls and no longer scrolls.
        */}
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-2 border-b bg-card/95 px-3 backdrop-blur md:hidden">
          <Link href="/admin" className="flex items-center">
            <Image
              src="/brand/logo-dark.png"
              alt="Needd Connect"
              width={110}
              height={16}
              priority
            />
          </Link>
          <span className="flex items-center">
            <NotificationBell />
            <SignOutButton compact />
          </span>
        </header>
        <main
          id="main-content"
          className="min-w-0 flex-1 p-4 pb-28 md:p-6 md:pb-6"
        >
          {children}
        </main>
        <AdminMobileNav />
      </div>
    </div>
  );
}
