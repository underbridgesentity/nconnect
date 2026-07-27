"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Every selection in the wizard is a server action plus a navigation. On a
 * mid-range Android that round trip is long enough to look like nothing
 * happened, so people tap twice. These buttons disable and say what they are
 * doing the instant they are pressed.
 */

export function PendingSubmit({
  children,
  pendingLabel,
  className,
  ariaLabel,
}: {
  children: React.ReactNode;
  pendingLabel: string;
  className?: string;
  ariaLabel?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-label={ariaLabel}
      aria-busy={pending || undefined}
      className={cn(className, pending && "opacity-70")}
    >
      {pending ? (
        <span className="flex items-center justify-center gap-2">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {pendingLabel}
        </span>
      ) : (
        children
      )}
    </button>
  );
}

/**
 * Card-shaped choices (plans, hardware) keep their own layout while pending:
 * the whole card dims and a spinner replaces the tick.
 */
export function PendingCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
      className={cn(className, pending && "opacity-60")}
    >
      {children}
      {pending ? (
        <span className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" aria-hidden />
          Updating your order...
        </span>
      ) : null}
    </button>
  );
}
