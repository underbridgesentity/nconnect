import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * EmptyState (spec §11): icon + one true sentence + one action.
 * Honest UI — states what is true and what happens next; never fake data.
 */
export function EmptyState({
  icon: Icon,
  sentence,
  action,
  className,
}: {
  icon: LucideIcon;
  sentence: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center",
        className
      )}
    >
      <Icon className="size-8 text-muted-foreground/60" aria-hidden />
      <p className="max-w-sm text-sm text-muted-foreground">{sentence}</p>
      {action}
    </div>
  );
}
