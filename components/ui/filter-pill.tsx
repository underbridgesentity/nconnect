import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The one filter and sort pill for the whole platform.
 *
 * Before this existed the same control was hand rolled in nine places as
 * `rounded-full px-3 py-1 text-sm`, a 28px box, and in the admin inbox as
 * `rounded-full px-2.5 py-0.5 text-xs`, a 20px box. Narrowing a list is the
 * main thing anyone does on a phone, so every one of those was a mis-tap
 * waiting to happen.
 *
 * The floor lives on `pointer-coarse`, the same variant the rest of the
 * primitives use, so a finger gets the project's 44px minimum while a mouse
 * keeps admin density. `min-h` rather than `h` so a call site that passes its
 * own height still clears the floor.
 *
 * The colours match what the call sites already use, so adopting this is a
 * class swap and nothing moves visually on desktop.
 */

export type FilterPillSize = "default" | "sm";

const BASE =
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full transition-colors pointer-coarse:min-h-11";

const SIZES: Record<FilterPillSize, string> = {
  /** Filter and sort rows: category sort, invoice status, report pickers. */
  default: "min-h-8 px-3 text-sm pointer-coarse:px-4",
  /** Dense chip rows such as the admin inbox, where nine chips share a strip. */
  sm: "min-h-7 px-2.5 text-xs pointer-coarse:px-3.5",
};

const STATES = {
  on: "bg-primary font-medium text-primary-foreground",
  off: "border text-muted-foreground hover:bg-accent hover:text-accent-foreground",
};

export function filterPillClass(
  active?: boolean,
  options: { size?: FilterPillSize; className?: string } = {}
) {
  const { size = "default", className } = options;
  return cn(BASE, SIZES[size], active ? STATES.on : STATES.off, className);
}

type SharedProps = {
  /** Whether this pill is the filter currently applied to the list. */
  active?: boolean;
  size?: FilterPillSize;
  className?: string;
  children: ReactNode;
};

/**
 * Filter that lives in the URL, so it stays a real link: it renders complete
 * on the server, middle clicks, and survives a reload.
 */
export function FilterPillLink({
  href,
  active,
  size,
  className,
  children,
  ...rest
}: SharedProps & { href: string } & Omit<
    ComponentProps<typeof Link>,
    "href" | "className" | "children"
  >) {
  return (
    <Link
      href={href}
      // Not aria-current="page": the page has not changed, the filter has.
      aria-current={active ? "true" : undefined}
      className={filterPillClass(active, { size, className })}
      {...rest}
    >
      {children}
    </Link>
  );
}

/** Filter held in client state rather than in the URL. */
export function FilterPillButton({
  active,
  size,
  className,
  children,
  type = "button",
  ...rest
}: SharedProps & Omit<ComponentProps<"button">, "className" | "children">) {
  return (
    <button
      type={type}
      aria-pressed={active}
      className={filterPillClass(active, { size, className })}
      {...rest}
    >
      {children}
    </button>
  );
}
