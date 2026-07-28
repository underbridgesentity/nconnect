"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Public site error boundary.
 *
 * The catalogue pages read the database on every revalidation, so the realistic
 * way a visitor lands here is that the database was briefly unreachable. That
 * shapes the copy: say the pricing could not be loaded rather than inventing a
 * generic apology, and keep the routes that do not need the catalogue (contact,
 * coverage) in front of them so the visit is not wasted.
 *
 * Renders from props alone. Anything that reads the database would fail for the
 * same reason we are here.
 *
 * Scope, measured rather than assumed: this catches render errors on dynamic
 * routes and during client-side navigation. It does NOT catch a failed ISR
 * generation, where Next serves its own 500 shell before any boundary runs.
 * That case only bites on a cold cache, because once a page has been generated
 * ISR serves the last good copy while revalidation fails, so it is really only
 * reachable by deploying while the database is down.
 */
export default function PublicError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("public page error:", error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-2xl flex-col justify-center px-4 py-16">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
        We could not load the pricing just now.
      </h1>
      <p className="mt-4 text-muted-foreground">
        This is a problem on our side, not with your connection. It is usually
        brief, so trying again in a moment is worth it.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <Button onClick={reset}>
          <RefreshCw className="size-4" aria-hidden />
          Try again
        </Button>
        <Button variant="outline" render={<Link href="/contact" />}>
          Talk to us
        </Button>
      </div>

      <p className="mt-10 text-sm text-muted-foreground">
        In the meantime you can still{" "}
        <Link href="/coverage" className="text-primary hover:underline">
          check coverage at your address
        </Link>{" "}
        or{" "}
        <Link href="/contact" className="text-primary hover:underline">
          ask us a question
        </Link>
        .
      </p>

      {error.digest ? (
        <p className="mt-8 text-xs text-muted-foreground">
          Reference: <span className="font-mono">{error.digest}</span>
        </p>
      ) : null}
    </div>
  );
}
