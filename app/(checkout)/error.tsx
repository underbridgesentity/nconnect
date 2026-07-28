"use client";

import { useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Checkout error boundary.
 *
 * This is the worst place on the site to show a raw stack-trace shell: the
 * customer is mid-purchase and deciding whether to trust us with a card. The
 * two things they need to know are that no money has moved and that their
 * selection is not lost, so both are said outright rather than implied.
 *
 * Kept deliberately independent of the checkout layout's data: the most likely
 * reason we are here at all is that a database read failed, so this must render
 * from nothing but props.
 */
export default function CheckoutError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("checkout error:", error);
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex h-14 max-w-2xl items-center px-4">
          <Image
            src="/brand/logo-dark.png"
            alt="Needd Connect"
            width={140}
            height={21}
            priority
            className="h-[19px] w-auto sm:h-[21px]"
          />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-4 py-16">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          We could not load the checkout.
        </h1>
        <p className="mt-4 text-muted-foreground">
          Something on our side failed while preparing your order. This is not
          something you did, and it is worth saying plainly:
        </p>

        <ul className="mt-4 space-y-2.5 text-sm">
          <li className="flex items-start gap-2.5">
            <ShieldCheck
              className="mt-0.5 size-4 shrink-0 text-primary"
              aria-hidden
            />
            <span>
              <strong className="font-semibold">No payment has been taken.</strong>{" "}
              Nothing reaches your card until you complete a checkout on
              PayFast, and you never got that far.
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <ShieldCheck
              className="mt-0.5 size-4 shrink-0 text-primary"
              aria-hidden
            />
            <span>
              <strong className="font-semibold">Your selection is saved.</strong>{" "}
              Trying again should pick up where you left off.
            </span>
          </li>
        </ul>

        <div className="mt-8 flex flex-wrap gap-3">
          <Button onClick={reset}>
            <RefreshCw className="size-4" aria-hidden />
            Try again
          </Button>
          <Button variant="outline" render={<Link href="/contact" />}>
            Talk to a human
          </Button>
        </div>

        {error.digest ? (
          <p className="mt-10 text-xs text-muted-foreground">
            If you contact us, quote reference{" "}
            <span className="font-mono">{error.digest}</span>.
          </p>
        ) : null}
      </main>
    </div>
  );
}
