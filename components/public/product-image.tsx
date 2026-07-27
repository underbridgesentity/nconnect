import { Router } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * One plate for every hardware photograph on the public site: the catalogue
 * grid, the product page and the suggestions on a plan page.
 *
 * Devices are photographed on white and some are cut out, so a bare <img> on
 * a white card has no edge and floats. A fixed aspect ratio plus a tinted
 * plate gives the grid an even rhythm regardless of source crop, and the
 * overflow clip keeps the card's img-zoom hover inside the rounded corner.
 *
 * When there is no photograph we show an outlined device glyph rather than a
 * grey box reading "image coming soon": a deliberate placeholder, not an
 * unfinished page.
 */
export function ProductImage({
  src,
  alt,
  ratio = "4/3",
  className,
}: {
  src: string | null;
  alt: string;
  ratio?: "4/3" | "1/1";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative grid place-items-center overflow-hidden rounded-2xl bg-muted/60 p-4",
        ratio === "1/1" ? "aspect-square" : "aspect-[4/3]",
        className
      )}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed storage URLs
        <img
          src={src}
          alt={alt}
          loading="lazy"
          className="max-h-full w-auto max-w-full object-contain"
        />
      ) : (
        <>
          <Router
            className="size-10 text-muted-foreground/40"
            strokeWidth={1.25}
            aria-hidden
          />
          <span className="sr-only">No photograph of {alt} yet</span>
        </>
      )}
    </div>
  );
}
