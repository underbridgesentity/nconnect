import Image from "next/image";
import Link from "next/link";
import { LayoutDashboard, ContactRound, FileText, Users } from "lucide-react";
import { auth } from "@/lib/auth";
import { SignOutButton } from "@/components/shared/sign-out-button";

const NAV = [
  { href: "/sales", label: "Home", icon: LayoutDashboard },
  { href: "/sales/leads", label: "Leads", icon: ContactRound },
  { href: "/sales/quotes", label: "Quotes", icon: FileText },
  { href: "/sales/customers", label: "My customers", icon: Users },
];

export default async function SalesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b bg-card px-3 md:px-6">
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
          <nav className="flex items-center gap-1">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex touch-target items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              >
                <item.icon className="size-4" aria-hidden />
                <span className="hidden sm:inline">{item.label}</span>
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden truncate text-xs text-muted-foreground sm:inline">
            {session?.user?.name}
          </span>
          <SignOutButton compact />
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 p-4 md:p-6">
        {children}
      </main>
    </div>
  );
}
