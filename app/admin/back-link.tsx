import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { filterPillClass } from "@/components/ui/filter-pill";

/**
 * The way back out of an admin detail screen.
 *
 * These were bare `←` glyphs at 12px with no border and no padding: a 6px
 * wide hit area, which on a phone is a coin toss, and a character a screen
 * reader either skips or reads as "leftwards arrow" in the middle of a
 * sentence. This gives the link a real control shape and borrows the pill's
 * coarse-pointer floor, so a finger gets the project's 44px minimum while a
 * mouse keeps admin density. A proper icon carries the direction and is
 * hidden from assistive tech, leaving the label to name the destination.
 */
export function BackLink({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={filterPillClass(false, { size: "sm", className })}
    >
      <ArrowLeft className="size-3.5 shrink-0" aria-hidden />
      {children}
    </Link>
  );
}
