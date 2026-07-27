import "server-only";

/**
 * The one place the site's own origin is resolved.
 *
 * Scattered `process.env.APP_URL ?? "http://localhost:3000"` fallbacks are a
 * production hazard: a missing variable does not fail loudly, it silently ships
 * localhost URLs into the sitemap, the canonical tags, every notification link,
 * password-setup links, and PayFast's return, cancel and notify URLs. A customer
 * would be redirected to their own machine after paying.
 *
 * So: in production a missing or non-https APP_URL is a hard error at first use,
 * and everywhere else it falls back to localhost. A trailing slash is stripped
 * so callers can always write `${appUrl()}/path`.
 */

let cached: string | null = null;

export function appUrl(): string {
  if (cached) return cached;

  const raw = process.env.APP_URL?.trim();
  const isProduction = process.env.NODE_ENV === "production";

  if (!raw) {
    if (isProduction) {
      throw new Error(
        "APP_URL is not set. Production builds need the public origin " +
          "(for example https://needdconnect.co.za) for canonical URLs, " +
          "notification links and PayFast return and notify URLs."
      );
    }
    cached = "http://localhost:3000";
    return cached;
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`APP_URL is not a valid URL: ${raw}`);
  }

  if (isProduction && parsed.protocol !== "https:") {
    throw new Error(
      `APP_URL must be https in production, got ${parsed.protocol}//`
    );
  }

  cached = raw.replace(/\/+$/, "");
  return cached;
}

/** Absolute URL for a site-relative path, for emails, PDFs and metadata. */
export function absoluteUrl(path: string): string {
  return `${appUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}
