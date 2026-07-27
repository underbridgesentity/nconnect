import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The one pill action for the whole platform (spec §11: rounded-full actions,
 * 44px minimum touch target).
 *
 * The same button was hand rolled in a dozen places, and every copy drifted:
 * horizontal padding ran px-4 through px-8, the glow was `shadow-lg
 * shadow-primary/25` in some files and `shadow-md shadow-primary/20` in
 * others, and the hover blue was `hover:bg-[#0f5a91]` in most but
 * `hover:bg-primary/90` in the signup steps. Nobody chose those differences,
 * they accumulated.
 *
 * So padding is a size prop with three rungs rather than a number a call site
 * invents, colour is a variant, and `className` merges last through
 * tailwind-merge, which means a genuine one-off (`w-full` in a checkout
 * column, an extra margin) still wins without forking the base.
 *
 * Three ways in, one look out:
 *   <PillLink href="/coverage">Check coverage</PillLink>
 *   <PillButton type="submit" size="lg">Pay now</PillButton>
 *   <span className={pillClass("primary", { size: "sm" })}>Open the pool</span>
 */

export type PillVariant = "primary" | "ink" | "outline" | "quiet";
export type PillSize = "sm" | "default" | "lg";

const BASE =
  "group inline-flex touch-target items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-60";

const SIZES: Record<PillSize, string> = {
  /** Tight rows: the site header, an action sitting beside a heading. */
  sm: "px-4",
  /** The default rung. Most actions on a card, a form or a list. */
  default: "px-6",
  /** Hero and page-level primary actions, where the pill carries the page. */
  lg: "px-8",
};

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

export type PillOptions = { size?: PillSize; className?: string };

/**
 * The class helper, for call sites that cannot be a component: a `<span>`
 * inside a wrapping `<Link>`, a shared `const` handed to `PendingSubmit`, a
 * third-party component that takes a className.
 *
 * The second argument also accepts a bare className string, which is how the
 * public mobile menu already calls it.
 */
export function pillClass(
  variant: PillVariant = "primary",
  options: string | PillOptions = {}
) {
  const opts: PillOptions =
    typeof options === "string" ? { className: options } : options;
  const { size = "default", className } = opts;
  return cn(BASE, SIZES[size], VARIANTS[variant], className);
}

type SharedProps = {
  variant?: PillVariant;
  size?: PillSize;
  className?: string;
  children: ReactNode;
};

export function PillLink({
  href,
  variant = "primary",
  size,
  className,
  children,
  ...rest
}: SharedProps & { href: string } & Omit<
    ComponentProps<"a">,
    "href" | "className" | "children"
  >) {
  const classes = pillClass(variant, { size, className });
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

/**
 * The same pill for a real action: a form submit, a dialog trigger, anything
 * that does something rather than going somewhere.
 */
export function PillButton({
  variant = "primary",
  size,
  className,
  children,
  type = "button",
  ...rest
}: SharedProps & Omit<ComponentProps<"button">, "className" | "children">) {
  return (
    <button
      type={type}
      className={pillClass(variant, { size, className })}
      {...rest}
    >
      {children}
    </button>
  );
}
