import Image from "next/image";
import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <Link href="/" className="mb-8">
        <Image
          src="/brand/logo-dark.png"
          alt="Needd Connect"
          width={180}
          height={26}
          priority
        />
      </Link>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
