import { formatCents, type Cents } from "@/lib/money";
import { cn } from "@/lib/utils";

/** MoneyText (spec §11): tabular numerals for every money figure. */
export function MoneyText({
  cents,
  whole = false,
  className,
}: {
  cents: Cents;
  whole?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("tnum font-mono", className)}>
      {formatCents(cents, { whole })}
    </span>
  );
}
