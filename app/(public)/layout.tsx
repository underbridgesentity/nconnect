import Image from "next/image";
import Link from "next/link";
import { getSetting } from "@/lib/domain/settings";

const NAV = [
  { href: "/internet", label: "Home Internet" },
  { href: "/fibre", label: "Fibre" },
  { href: "/voip", label: "Business VoIP" },
  { href: "/sim-data", label: "SIM Data" },
  { href: "/hardware", label: "Hardware" },
  { href: "/coverage", label: "Coverage" },
];

type Company = {
  legalName: string;
  website: string;
  phone: string;
  email: string;
  vat: string;
  reg: string;
  bbbee: string;
};

export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const company = await getSetting<Company>("company");

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 border-b bg-card/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
          <Link href="/" aria-label="Needd Connect home">
            <Image
              src="/brand/logo-dark.png"
              alt="Needd Connect"
              width={140}
              height={21}
              priority
            />
          </Link>
          <nav
            className="hidden items-center gap-1 lg:flex"
            aria-label="Main navigation"
          >
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-full px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="touch-target flex items-center whitespace-nowrap rounded-full px-3 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="touch-target flex items-center whitespace-nowrap rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-md shadow-primary/20 transition-colors hover:bg-[#0f5a91]"
            >
              Get connected
            </Link>
          </div>
        </div>
        {/* Mobile nav: plain links, fully readable without JS */}
        <nav
          className="flex items-center gap-1 overflow-x-auto border-t px-4 py-2 lg:hidden"
          aria-label="Main navigation mobile"
        >
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t bg-card">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Image
              src="/brand/logo-dark.png"
              alt="Needd Connect"
              width={130}
              height={19}
            />
            <p className="mt-3 text-sm text-muted-foreground">
              One provider, one bill, local support. Accredited reseller of
              MTN, Vodacom and Telkom, with fibre on Openserve, Vumatel,
              Frogfoot and MetroFibre.
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold">Products</h3>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              {NAV.slice(0, 5).map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="hover:text-foreground">
                    {item.label}
                  </Link>
                </li>
              ))}
              <li>
                <Link href="/bundles" className="hover:text-foreground">
                  Bundles
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold">Company</h3>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li>
                <Link href="/about" className="hover:text-foreground">
                  About
                </Link>
              </li>
              <li>
                <Link href="/contact" className="hover:text-foreground">
                  Contact
                </Link>
              </li>
              <li>
                <Link href="/help" className="hover:text-foreground">
                  Help & FAQ
                </Link>
              </li>
              <li>
                <Link href="/blog" className="hover:text-foreground">
                  Blog
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold">Legal & contact</h3>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li>
                <Link href="/legal/privacy" className="hover:text-foreground">
                  Privacy Policy (POPIA)
                </Link>
              </li>
              <li>
                <Link href="/legal/terms" className="hover:text-foreground">
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link href="/legal/rica" className="hover:text-foreground">
                  RICA information
                </Link>
              </li>
              {company ? (
                <>
                  <li>
                    <a
                      href={`tel:${company.phone.replace(/\s/g, "")}`}
                      className="hover:text-foreground"
                    >
                      {company.phone}
                    </a>
                  </li>
                  <li>
                    <a
                      href={`mailto:${company.email}`}
                      className="hover:text-foreground"
                    >
                      {company.email}
                    </a>
                  </li>
                </>
              ) : null}
            </ul>
          </div>
        </div>
        <div className="border-t">
          <p className="mx-auto max-w-6xl px-4 py-4 text-xs text-muted-foreground">
            {company
              ? `${company.legalName} | Reg ${company.reg} | VAT ${company.vat} | ${company.bbbee}`
              : "Needd Technology Solutions (Pty) Ltd"}
          </p>
        </div>
      </footer>
    </div>
  );
}
