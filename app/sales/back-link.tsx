import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { filterPillClass } from "@/components/ui/filter-pill";

/**
 * The way back out of a sales detail screen.
 *
 * Reps run this one-handed on a phone, and every back link here was a bare
 * `←` glyph at 12px: roughly a 6px hit area with no border, no padding and
 * nothing to aim at. This gives it a real control shape and borrows the
 * pill's coarse-pointer floor for the project's 44px touch minimum, while
 * desktop keeps the same compact look it had. The icon is hidden from
 * assistive tech so the label alone names the destination.
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
