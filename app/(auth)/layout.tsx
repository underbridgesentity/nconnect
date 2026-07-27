import Image from "next/image";
import Link from "next/link";

/**
 * Sign-in shell. One column, no navigation, so there is nothing to skip past:
 * the landmark that matters is <main>, which lets a screen reader jump to the
 * form on any of these pages.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <Link href="/" className="mb-8" aria-label="Needd Connect home">
        <Image
          src="/brand/logo-dark.png"
          alt="Needd Connect"
          width={180}
          height={26}
          priority
        />
      </Link>
      <main id="main-content" className="w-full max-w-sm">
        {children}
      </main>
    </div>
  );
}
