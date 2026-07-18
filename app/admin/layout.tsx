import Image from "next/image";
import Link from "next/link";
import {
  ListTodo,
  Users,
  Package,
  Receipt,
  Inbox,
  BarChart3,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { SignOutButton } from "@/components/shared/sign-out-button";
import { NotificationBell } from "@/components/shared/bell";

const NAV = [
  { href: "/admin", label: "Today", icon: ListTodo },
  { href: "/admin/customers", label: "Customers", icon: Users },
  { href: "/admin/catalogue", label: "Catalogue", icon: Package },
  { href: "/admin/billing", label: "Billing", icon: Receipt },
  { href: "/admin/inbox", label: "Inbox", icon: Inbox },
  { href: "/admin/reports", label: "Reports & Settings", icon: BarChart3 },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  return (
    <div className="flex min-h-dvh w-full">
      <aside className="hidden w-56 shrink-0 flex-col border-r bg-sidebar md:flex">
        <div className="flex h-14 items-center border-b px-4">
          <Link href="/admin">
            <Image
              src="/brand/logo-dark.png"
              alt="Needd Connect"
              width={110}
              height={16}
              priority
            />
          </Link>
        </div>
        <nav className="flex-1 space-y-1 p-2">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <item.icon className="size-4" aria-hidden />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center justify-between border-t p-3">
          <span className="truncate text-xs text-muted-foreground">
            {session?.user?.name}
          </span>
          <span className="flex items-center">
            <NotificationBell />
            <SignOutButton compact />
          </span>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar (admin is fully usable at 390px, spec §16.8) */}
        <header className="flex h-14 items-center justify-between gap-2 overflow-x-auto border-b bg-card px-3 md:hidden">
          <nav className="flex items-center gap-1">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex touch-target items-center rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              >
                <item.icon className="size-4" aria-label={item.label} />
              </Link>
            ))}
          </nav>
          <span className="flex items-center">
            <NotificationBell />
            <SignOutButton compact />
          </span>
        </header>
        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
