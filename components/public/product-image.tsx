import Image from "next/image";
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

/**
 * How wide the plate really renders, per layout, so a phone downloads a phone
 * sized image instead of the full upload. Product photography goes into the
 * public `catalogue` bucket at whatever resolution the supplier sent it, and
 * the image optimiser can only pick a size if it is told the slot width.
 *
 * The two values come from the actual call sites:
 *
 * - 4/3 is the card grids. Hardware index: max-w-6xl, sm:grid-cols-2,
 *   lg:grid-cols-4, so about 200px inside the card padding on a wide screen.
 *   Plan suggestions: max-w-5xl, sm:grid-cols-3, about 250px.
 * - 1/1 is the product page hero: max-w-5xl, md:grid-cols-2, so half the
 *   container from md up and the full width below it.
 *
 * They deliberately round up. Asking for slightly more than the slot costs a
 * few kilobytes; asking for less puts a soft image in front of a customer
 * deciding whether to buy the router.
 */
const PLATE_SIZES = {
  "4/3": "(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw",
  "1/1": "(min-width: 768px) 50vw, 100vw",
} as const;

export function ProductImage({
  src,
  alt,
  ratio = "4/3",
  className,
  sizes,
  priority = false,
}: {
  /**
   * A `fileUrl("catalogue", ...)` URL, or null when the device has no
   * photograph yet. The host has to be allowlisted in next.config.ts, so this
   * is not the place for an arbitrary external image.
   */
  src: string | null;
  alt: string;
  ratio?: "4/3" | "1/1";
  className?: string;
  /** Override the slot width hint when the plate sits in a different layout. */
  sizes?: string;
  /** Set on an above-the-fold hero so it is not lazy-loaded. */
  priority?: boolean;
}) {
  // next/image throws on an empty src, which would take a whole catalogue page
  // down over one bad row. A missing photograph is the placeholder's job.
  const source = src && src.trim() ? src : null;

  /*
   * In production these are public Supabase storage URLs and the optimiser
   * resizes them (see remotePatterns in next.config.ts). Outside production the
   * storage adapter serves the same files from `/api/files/...` behind an
   * expiring HMAC signature, and those must not go through the optimiser:
   * next/image would need every signed query string allowlisted, and an
   * optimised copy is cached under a signature that has already expired, which
   * quietly outlives the access control it was meant to enforce. Serving them
   * unoptimised keeps the signature meaningful and the build honest.
   */
  const isSignedLocalFile = source?.startsWith("/api/files/") ?? false;

  return (
    <div
      className={cn(
        "relative grid place-items-center overflow-hidden rounded-2xl bg-muted/60 p-4",
        ratio === "1/1" ? "aspect-square" : "aspect-[4/3]",
        className
      )}
    >
      {source ? (
        /*
         * `fill` positions the image against the padding box of the nearest
         * positioned ancestor, which would swallow the plate's padding (and
         * the p-8 the product page passes). This inner box is the grid area,
         * so it is exactly the content box, and the inset survives.
         */
        <div className="relative h-full w-full">
          <Image
            src={source}
            alt={alt}
            fill
            sizes={sizes ?? PLATE_SIZES[ratio]}
            priority={priority}
            unoptimized={isSignedLocalFile}
            className="object-contain"
          />
        </div>
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
