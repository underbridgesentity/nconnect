"use client";

import { useEffect } from "react";
import Link from "next/link";
import { LifeBuoy, RefreshCw, Home } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Portal error boundary. Rendered inside the portal shell, so the header and
 * the tab bar stay put: a customer is never dumped onto an unbranded page
 * with no way back, which in the installed PWA means no back button at all.
 */
export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("portal error:", error);
  }, [error]);

  return (
    <div className="space-y-5 py-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          That did not load.
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our side, not yours. Nothing you were doing
          has been lost, and no payment or plan change happens without a
          confirmation screen. Try again below.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Button onClick={reset} className="w-full touch-target">
          <RefreshCw className="size-4" aria-hidden />
          Try again
        </Button>
        <Button
          variant="outline"
          className="w-full touch-target"
          render={<Link href="/portal" />}
        >
          <Home className="size-4" aria-hidden />
          My services
        </Button>
        <Button
          variant="ghost"
          className="w-full touch-target"
          render={<Link href="/portal/help" />}
        >
          <LifeBuoy className="size-4" aria-hidden />
          Get help
        </Button>
      </div>

      {error.digest ? (
        <p className="text-xs text-muted-foreground">
          If you message us, quote this reference:{" "}
          <span className="font-mono">{error.digest}</span>
        </p>
      ) : null}
    </div>
  );
}
