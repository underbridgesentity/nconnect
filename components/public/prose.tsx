import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The reading column used by every long-form public page: legal documents,
 * help, about and blog posts.
 *
 * Two deliberate choices. The measure is capped at 68ch rather than the old
 * max-w-3xl, which at 15px ran to roughly 100 characters a line. And the body
 * is foreground/85 rather than text-muted-foreground, which sat at the bare
 * AA minimum on the warm page background: the documents customers are told to
 * read must not be the lowest-contrast copy on the site. Muted grey is now
 * reserved for metadata such as "Last reviewed July 2026".
 */
const PROSE = [
  "max-w-[68ch] text-base leading-7 text-foreground/85",
  "[&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-foreground",
  "[&_h3]:mb-1.5 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-foreground",
  "[&_p+p]:mt-4",
  "[&_ul]:mt-3 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5",
  "[&_ol]:mt-3 [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:pl-5",
  "[&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2",
  "[&_strong]:font-semibold [&_strong]:text-foreground",
].join(" ");

/** Adds the vertical rhythm for documents built out of <section> blocks. */
const PROSE_SECTIONS = "[&>section+section]:mt-9";

/** Adds the rhythm for flat long-form content such as rendered MDX. */
const PROSE_FLOW = "[&_h2]:mt-10 [&_h2:first-child]:mt-0";

export function Prose({
  children,
  flow = "sections",
  className,
}: {
  children: ReactNode;
  /** "sections" for <section> per heading, "flow" for continuous copy or MDX. */
  flow?: "sections" | "flow";
  className?: string;
}) {
  return (
    <div
      className={cn(
        PROSE,
        flow === "sections" ? PROSE_SECTIONS : PROSE_FLOW,
        className
      )}
    >
      {children}
    </div>
  );
}
