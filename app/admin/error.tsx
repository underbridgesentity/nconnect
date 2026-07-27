"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ListTodo, RefreshCw, Users } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Admin error boundary.
 *
 * Without this, a failed query anywhere under /admin fell through to the root
 * boundary, which is written for a customer on the marketing site and offers
 * "Contact support" as the way out. An operator got no sidebar, no way back to
 * the queue, and advice to email the company they work for. This renders
 * inside the admin layout, so the sidebar and the mobile nav stay put and the
 * only thing that changed is the content area.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("admin error:", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-2xl space-y-5 py-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          This screen did not load.
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something failed on our side while reading the data for this page. No
          record was changed and nothing was written, so it is safe to try
          again. If it keeps failing, the rest of the workspace still works.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={reset}>
          <RefreshCw className="size-4" aria-hidden />
          Try again
        </Button>
        <Button variant="outline" render={<Link href="/admin" />}>
          <ListTodo className="size-4" aria-hidden />
          Back to Today
        </Button>
        <Button variant="ghost" render={<Link href="/admin/customers" />}>
          <Users className="size-4" aria-hidden />
          Customers
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
