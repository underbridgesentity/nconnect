import type { Metadata } from "next";
import Image from "next/image";
import { WifiOff } from "lucide-react";

export const metadata: Metadata = {
  title: "You're offline",
  robots: { index: false },
};

export default function OfflinePage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <Image
        src="/brand/logo-dark.png"
        alt="Needd Connect"
        width={140}
        height={21}
      />
      <WifiOff className="size-8 text-muted-foreground" aria-hidden />
      <h1 className="text-xl font-semibold">You&apos;re offline</h1>
      <p className="max-w-xs text-sm text-muted-foreground">
        We can&apos;t reach the internet right now, which, we admit, is
        awkward for an internet company. Your portal will load again the
        moment you&apos;re back online.
      </p>
    </div>
  );
}
