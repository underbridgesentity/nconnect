"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ContactRound, LayoutDashboard, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Sales error boundary.
 *
 * Reps work this on a phone between calls, so being dumped onto the marketing
 * error page with a "Contact support" button was worse than useless: it lost
 * the header nav and told a rep to email their own company. This renders
 * inside the sales layout, so the nav survives and a retry is one tap away.
 */
export default function SalesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("sales error:", error);
  }, [error]);

  return (
    <div className="space-y-5 py-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          This screen did not load.
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something failed on our side while loading this page. No lead, quote
          or customer was changed, so nothing you had captured is lost. Try
          again below.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={reset}>
          <RefreshCw className="size-4" aria-hidden />
          Try again
        </Button>
        <Button variant="outline" render={<Link href="/sales" />}>
          <LayoutDashboard className="size-4" aria-hidden />
          My pipeline
        </Button>
        <Button variant="ghost" render={<Link href="/sales/leads" />}>
          <ContactRound className="size-4" aria-hidden />
          Leads
        </Button>
      </div>

      {error.digest ? (
        <p className="text-xs text-muted-foreground">
          Quote this reference when reporting it:{" "}
          <span className="font-mono">{error.digest}</span>
        </p>
      ) : null}
    </div>
  );
}
