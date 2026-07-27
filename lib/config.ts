import "server-only";

/**
 * The one place the site's own origin is resolved.
 *
 * Scattered `process.env.APP_URL ?? "http://localhost:3000"` fallbacks are a
 * production hazard: a missing variable does not fail loudly, it silently ships
 * localhost URLs into the sitemap, canonical tags, every notification link,
 * staff setup links, and PayFast's return, cancel and notify URLs. A customer
 * would be redirected to their own machine after paying.
 *
 * The guard is deliberately narrow. `next build` sets NODE_ENV=production even
 * for a local build, so refusing anything non-https there would break the
 * developer's own build. Instead: a localhost origin is always allowed, a
 * non-https public host is rejected, and a missing value falls back to Vercel's
 * deployment URL before failing.
 */

let cached: string | null = null;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]"]);

function normalise(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(
      `APP_URL is not a valid absolute URL: ${raw}. Expected something like https://needdconnect.co.za`
    );
  }
  if (parsed.protocol !== "https:" && !LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error(
      `APP_URL must be https for a public host, got ${raw}. PayFast return URLs and customer links are built from it.`
    );
  }
  return raw.replace(/\/+$/, "");
}

export function appUrl(): string {
  if (cached) return cached;

  const explicit = process.env.APP_URL?.trim();
  if (explicit) {
    cached = normalise(explicit);
    return cached;
  }

  // Vercel injects these; the production one is stable across deployments,
  // the other is the per-deployment preview host.
  const vercel =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (vercel) {
    cached = normalise(`https://${vercel}`);
    return cached;
  }

  if (process.env.NODE_ENV === "production" && process.env.VERCEL) {
    throw new Error(
      "APP_URL is not set. The deployed app needs its public origin for " +
        "canonical URLs, notification links and PayFast return and notify URLs."
    );
  }

  cached = "http://localhost:3000";
  return cached;
}

/** Absolute URL for a site-relative path, for emails, PDFs and metadata. */
export function absoluteUrl(path: string): string {
  return `${appUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}
