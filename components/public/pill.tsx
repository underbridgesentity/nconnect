import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The one pill button used across the public site (spec §11: rounded-full
 * actions, 44px minimum touch target). Every marketing page links through
 * this so the call to action looks the same on the home page, a category
 * band, a plan page and the legal footer of a policy document.
 */

export type PillVariant = "primary" | "ink" | "outline" | "quiet";

const BASE =
  "group inline-flex touch-target items-center justify-center gap-2 whitespace-nowrap rounded-full px-6 text-sm font-semibold transition-colors";

const VARIANTS: Record<PillVariant, string> = {
  /** Brand blue, for the single most important action on a surface. */
  primary:
    "bg-primary text-primary-foreground shadow-lg shadow-primary/25 hover:bg-[#0f5a91]",
  /** Secondary action sitting on an ink (#121829) band. */
  ink: "border border-white/25 bg-white/10 text-white backdrop-blur hover:bg-white/20",
  /** Secondary action on a light surface. */
  outline: "border bg-card text-foreground hover:bg-accent",
  /** Tertiary action, no chrome until hover. */
  quiet: "text-foreground hover:bg-accent",
};

export function pillClass(variant: PillVariant = "primary", className?: string) {
  return cn(BASE, VARIANTS[variant], className);
}

export function PillLink({
  href,
  variant = "primary",
  className,
  children,
  ...rest
}: {
  href: string;
  variant?: PillVariant;
  className?: string;
  children: ReactNode;
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "className">) {
  const classes = pillClass(variant, className);
  // tel:, mailto: and wa.me links are not app routes, so they render as
  // plain anchors rather than going through the client router.
  if (!href.startsWith("/")) {
    return (
      <a href={href} className={classes} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={classes} {...rest}>
      {children}
    </Link>
  );
}
