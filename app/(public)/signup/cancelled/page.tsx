import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Payment cancelled",
  robots: { index: false },
};

export default function SignupCancelledPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">No payment was taken</h1>
      <p className="mt-2 text-muted-foreground">
        You cancelled at PayFast, your order is saved and nothing was charged.
        Pick up where you left off whenever you&apos;re ready.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <Link
          href="/signup?step=3"
          className="flex touch-target items-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Try again
        </Link>
        <Link
          href="/contact"
          className="flex touch-target items-center rounded-md border px-6 text-sm font-medium hover:bg-accent"
        >
          Talk to us
        </Link>
      </div>
    </div>
  );
}
