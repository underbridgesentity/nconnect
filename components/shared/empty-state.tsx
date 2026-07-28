import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The one empty state for the whole platform (spec §11, and guardrail 1: no
 * fake data, ever, so a list with nothing in it says so plainly).
 *
 * The same block was hand rolled roughly 25 times as a bare paragraph with a
 * dashed border, across five corner radii (`rounded-md`, `rounded-lg`,
 * `rounded-2xl`, `rounded-3xl` and this component's own) and four paddings.
 * One radius now: `rounded-xl`, the same surface radius the Card primitive
 * uses, because an empty state stands in for the card or list that would
 * otherwise be there.
 *
 * Two densities, because "this whole page has nothing on it" and "this one
 * card's list is empty" are genuinely different jobs. Everything else is the
 * same everywhere.
 *
 * Semantics: this is ordinary content, not a live region. A permanently empty
 * list is not an announcement, and marking it `role="status"` makes a screen
 * reader interrupt itself on every render. Pass `loading` only while
 * something is genuinely in flight, and only then does it become a status
 * region.
 */

const DEFAULT_TITLE = "Nothing here yet";
const DEFAULT_DESCRIPTION = "There is nothing to show yet.";

export function EmptyState({
  icon: Icon,
  title,
  description,
  sentence,
  action,
  compact = false,
  loading = false,
  className,
}: {
  /** Optional. A quiet visual anchor, never the message itself. */
  icon?: LucideIcon;
  /** The short true statement, e.g. "No invoices yet". */
  title?: string;
  /** What happens next, e.g. "Your first one arrives a month after activation." */
  description?: string;
  /**
   * The prop `description` used to be called. Every staff call site has moved
   * across; the four still passing it are the public bundles page and the
   * three portal pages, which belong to another owner. Delete this alias, and
   * the `?? sentence` below, once those four are migrated. Nothing new should
   * reach for it.
   *
   * @deprecated Use `description`.
   */
  sentence?: string;
  /** One action at most: a link or a pill, never a row of choices. */
  action?: ReactNode;
  /** Dense variant for an empty list inside a card or a panel. */
  compact?: boolean;
  /** True only while something is actually in flight. */
  loading?: boolean;
  className?: string;
}) {
  const body = description ?? sentence;
  // Honest defaults: say nothing is here, never imply something is coming
  // that we cannot promise. Only fill both in when the call site gave us
  // neither, so a lone `description` still renders as a lone sentence and a
  // lone `title` as a lone statement.
  const heading = title ?? (body ? undefined : DEFAULT_TITLE);
  const text = body ?? (title ? undefined : DEFAULT_DESCRIPTION);

  return (
    <div
      role={loading ? "status" : undefined}
      aria-busy={loading || undefined}
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed text-center",
        compact ? "gap-1.5 px-4 py-6" : "gap-3 px-6 py-12",
        className
      )}
    >
      {Icon ? (
        <Icon
          className={cn(
            "text-muted-foreground/60",
            compact ? "size-5" : "size-8"
          )}
          aria-hidden
        />
      ) : null}
      {heading ? (
        <p className="text-sm font-medium text-foreground">{heading}</p>
      ) : null}
      {text ? (
        <p
          className={cn(
            "text-muted-foreground",
            compact ? "text-xs" : "max-w-sm text-sm"
          )}
        >
          {text}
        </p>
      ) : null}
      {action}
    </div>
  );
}
