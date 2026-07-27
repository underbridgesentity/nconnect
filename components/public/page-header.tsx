import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The ink header band that opens every public page (spec §11).
 *
 * Two variants share one set of proportions so the site reads as one product:
 * `photo` lays brand photography under a diagonal ink scrim, `plain` uses a
 * radial ink gradient for pages that have no honest photograph to show
 * (legal, blog posts, product detail).
 *
 * The h1 is never wrapped in Reveal: this band is always above the fold, and
 * the largest text on the page must paint from the server HTML rather than
 * waiting for hydration.
 */

export type Crumb = { label: string; href?: string };
export type HeaderStat = { label: string; value: ReactNode };

/**
 * Diagonal scrim: heavy behind the copy in the lower left, opening up towards
 * the top right so the photograph is genuinely visible. Written as an inline
 * style rather than an arbitrary Tailwind value because the rgb()/alpha
 * syntax does not survive class-name escaping cleanly.
 */
const PHOTO_SCRIM =
  "linear-gradient(to top right, rgb(18 24 41 / 0.92) 0%, rgb(18 24 41 / 0.72) 46%, rgb(18 24 41 / 0.36) 100%)";

const PLAIN_BAND =
  "radial-gradient(115% 130% at 8% 110%, #1b2545 0%, #151c33 42%, #121829 72%, #0e1322 100%)";

export function PageHeader({
  image,
  imageAlt = "",
  imagePosition = "50% 50%",
  eyebrow,
  title,
  breadcrumb,
  stats,
  actions,
  size = "default",
  children,
}: {
  /** Omit for the plain ink gradient band. */
  image?: string;
  imageAlt?: string;
  /** CSS object-position, so each page picks its own crop. */
  imagePosition?: string;
  eyebrow?: ReactNode;
  title: ReactNode;
  breadcrumb?: Crumb[];
  stats?: HeaderStat[];
  actions?: ReactNode;
  size?: "default" | "compact";
  children?: ReactNode;
}) {
  const compact = size === "compact";
  return (
    <section
      data-surface="ink"
      className="relative isolate overflow-hidden bg-[#121829]"
    >
      {image ? (
        <>
          <Image
            src={image}
            alt={imageAlt}
            fill
            priority
            sizes="100vw"
            style={{ objectPosition: imagePosition }}
            className="object-cover opacity-90"
          />
          <div
            className="absolute inset-0"
            style={{ background: PHOTO_SCRIM }}
            aria-hidden
          />
        </>
      ) : (
        <div
          className="absolute inset-0"
          style={{ background: PLAIN_BAND }}
          aria-hidden
        />
      )}
      <div
        className={cn(
          "relative mx-auto flex w-full max-w-6xl flex-col justify-end px-4",
          compact
            ? "min-h-[230px] py-12 md:min-h-[290px] md:py-14"
            : "min-h-[340px] py-14 md:min-h-[440px] md:py-20"
        )}
      >
        {breadcrumb?.length ? (
          <nav
            aria-label="Breadcrumb"
            className="mb-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-white/55"
          >
            {breadcrumb.map((crumb, index) => (
              <span key={crumb.label} className="flex items-center gap-2">
                {index > 0 ? (
                  <span aria-hidden className="text-white/25">
                    /
                  </span>
                ) : null}
                {crumb.href ? (
                  <Link
                    href={crumb.href}
                    className="rounded-full transition-colors hover:text-white"
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="text-white/80">{crumb.label}</span>
                )}
              </span>
            ))}
          </nav>
        ) : null}

        {eyebrow ? (
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-white/55">
            {eyebrow}
          </p>
        ) : null}

        <h1
          className={cn(
            "max-w-3xl font-semibold tracking-tight text-white",
            compact ? "text-3xl md:text-4xl" : "text-3xl md:text-5xl"
          )}
        >
          {title}
        </h1>

        {children ? (
          <div className="mt-4 max-w-2xl text-white/75 [&_a]:font-medium [&_a]:text-white [&_a]:underline [&_a]:underline-offset-2">
            {children}
          </div>
        ) : null}

        {stats?.length ? (
          <dl className="mt-8 flex flex-wrap gap-x-10 gap-y-4 text-white">
            {stats.map((stat) => (
              <div key={stat.label}>
                <dt className="text-xs uppercase tracking-wider text-white/50">
                  {stat.label}
                </dt>
                <dd className="mt-0.5 text-2xl font-semibold">{stat.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {actions ? (
          <div className="mt-8 flex flex-wrap gap-3">{actions}</div>
        ) : null}
      </div>
    </section>
  );
}
