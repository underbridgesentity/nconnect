"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Card-shaped choices (plans, hardware) keep their own layout while pending:
 * the whole card dims and says what it is busy doing, because each of these is
 * a server action plus a navigation and nothing else on screen moves.
 *
 * The plain button version lives in components/ui/pending-submit.tsx, which
 * the pay screens share.
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
