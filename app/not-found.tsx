import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export const metadata = {
  title: "Page not found",
  robots: { index: false, follow: true },
};

const LINKS = [
  { href: "/internet", label: "Home Internet" },
  { href: "/fibre", label: "Fibre" },
  { href: "/coverage", label: "Check coverage" },
  { href: "/help", label: "Help and FAQ" },
];

/**
 * Root 404 (spec §11): branded, honest, and always offers a way forward.
 * Rendered outside the public layout, so it carries its own header and links.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col bg-[#121829] text-white">
      <header className="mx-auto flex w-full max-w-6xl items-center px-4 py-6">
        <Link href="/" aria-label="Needd Connect home">
          <Image
            src="/brand/logo-white.png"
            alt="Needd Connect"
            width={140}
            height={21}
            priority
          />
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-4 py-16">
        <p className="text-sm font-semibold tracking-wide text-sky-400">
          404
        </p>
        <h1 className="mt-3 max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">
          We could not find that page.
        </h1>
        <p className="mt-4 max-w-xl text-lg text-white/70">
          The link may be old, or the page may have moved. Everything below is
          still where you expect it.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/"
            className="touch-target inline-flex items-center gap-2 rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-md shadow-primary/20 transition-colors hover:bg-[#0f5a91]"
          >
            Back to home
            <ArrowRight className="size-4" aria-hidden />
          </Link>
          <Link
            href="/contact"
            className="touch-target inline-flex items-center rounded-full border border-white/20 px-6 text-sm font-semibold text-white transition-colors hover:bg-white/10"
          >
            Talk to us
          </Link>
        </div>

        <nav className="mt-12 border-t border-white/10 pt-6" aria-label="Popular pages">
          <p className="text-xs font-semibold tracking-wide text-white/50">
            POPULAR PAGES
          </p>
          <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
            {LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="text-sm text-white/80 underline-offset-4 hover:text-white hover:underline"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </main>
    </div>
  );
}
