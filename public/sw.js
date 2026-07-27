/**
 * Needd Connect service worker (spec §3 PWA): an installable portal with an
 * offline shell.
 *
 * The one rule that matters here: nothing belonging to a signed-in customer is
 * ever written to a cache. Every page in this product is personal (balances,
 * invoices, line status, ticket threads), phones get shared and handed around,
 * and a cached HTML page outlives the session cookie. So:
 *
 *  - navigations are network first and their responses are never stored,
 *  - React Server Component payloads (?_rsc) and /api routes are not touched
 *    at all, so no server action or JSON response can be served from cache,
 *  - the only things cached are the public /offline page, brand artwork, and
 *    content hashed build output under /_next/static, none of which is
 *    specific to a person. All three are fetched with credentials omitted so a
 *    personalised variant cannot slip in.
 *
 * The offline page is precached together with the CSS and JS chunks it refers
 * to. Without that it renders unstyled and dead, which is a poor way to meet
 * someone whose signal just dropped.
 */

const VERSION = "v2";
const SHELL_CACHE = `nc-shell-${VERSION}`;
const ASSET_CACHE = `nc-assets-${VERSION}`;
const CURRENT_CACHES = [SHELL_CACHE, ASSET_CACHE];

const OFFLINE_URL = "/offline";
const BRAND_ASSETS = [
  "/brand/logo-white.png",
  "/brand/logo-dark.png",
  "/brand/icon-192.png",
];

/** Chunks pulled in alongside the offline page. A ceiling, not a target. */
const MAX_OFFLINE_ASSETS = 40;
/** Rough cap on the build output cache, oldest entries evicted first. */
const MAX_ASSET_ENTRIES = 120;
/** Re-fetch the offline shell if the cached copy is older than this. */
const OFFLINE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CACHED_AT_HEADER = "x-nc-cached-at";

/**
 * In development the files under /_next/static are rebuilt in place rather
 * than content hashed, so caching them serves yesterday's JavaScript and
 * breaks hot reload. The offline shell still works locally, only the build
 * output cache is switched off.
 */
const IS_LOCAL = ["localhost", "127.0.0.1", "[::1]"].includes(
  self.location.hostname
);

/**
 * Safety here comes from the path allowlist in the fetch handler and from
 * fetching with credentials omitted, not from response headers: Next serves
 * plenty of perfectly public pages with a no-store Cache-Control, and reading
 * that as "unsafe to cache" would quietly leave us with no offline shell.
 * "basic" means same origin and fully readable, so an opaque response is never
 * stored blind.
 */
function isCacheable(response) {
  return Boolean(response) && response.ok && response.type === "basic";
}

async function trimCache(cache, max) {
  const keys = await cache.keys();
  if (keys.length <= max) return;
  // Cache.keys() returns insertion order, so the head of the list is oldest.
  await Promise.all(
    keys.slice(0, keys.length - max).map((key) => cache.delete(key))
  );
}

/**
 * Cache the stylesheet, fonts and chunks the offline page names, so it renders
 * as designed rather than as unstyled black text on white.
 */
async function precacheOfflineAssets(html) {
  if (IS_LOCAL) return;
  const found = html.match(/\/_next\/static\/[^"'`\s\\<>]+/g) || [];
  const urls = [...new Set(found)]
    .filter((url) => /\.(?:css|js|woff2?)(?:\?|$)/.test(url))
    .slice(0, MAX_OFFLINE_ASSETS);
  if (urls.length === 0) return;

  const cache = await caches.open(ASSET_CACHE);
  await Promise.allSettled(
    urls.map(async (url) => {
      if (await cache.match(url)) return;
      const response = await fetch(url, { credentials: "omit" });
      if (isCacheable(response)) await cache.put(url, response);
    })
  );
}

async function precacheOffline() {
  const response = await fetch(OFFLINE_URL, {
    cache: "reload",
    credentials: "omit",
  });
  if (!isCacheable(response)) return;

  const html = await response.text();
  /*
   * Built from scratch rather than copied from the original. response.text()
   * hands back a decoded body while the original headers still advertise
   * Content-Encoding and the compressed Content-Length, and storing that pair
   * gives the browser a body it cannot decode. Only the two headers that are
   * actually true of what we are storing go on: the type, and our own stamp,
   * so staleness never depends on the origin having sent a Date.
   */
  const headers = new Headers({
    "Content-Type":
      response.headers.get("content-type") || "text/html; charset=utf-8",
    [CACHED_AT_HEADER]: String(Date.now()),
  });

  const shell = await caches.open(SHELL_CACHE);
  await shell.put(OFFLINE_URL, new Response(html, { status: 200, headers }));
  await precacheOfflineAssets(html);
}

async function precacheBrand() {
  const shell = await caches.open(SHELL_CACHE);
  await Promise.allSettled(
    BRAND_ASSETS.map(async (path) => {
      const response = await fetch(path, {
        cache: "reload",
        credentials: "omit",
      });
      if (isCacheable(response)) await shell.put(path, response);
    })
  );
}

/**
 * A deploy leaves the cached shell pointing at chunk names that no longer
 * exist on the origin. The cached chunks keep it working, but it slowly drifts
 * away from the live design, so refresh it once a day off the back of a
 * navigation that already proved the network is there.
 */
async function refreshOfflineIfStale() {
  const shell = await caches.open(SHELL_CACHE);
  const cached = await shell.match(OFFLINE_URL);
  if (cached) {
    const stamp = Number(cached.headers.get(CACHED_AT_HEADER));
    if (Number.isFinite(stamp) && Date.now() - stamp < OFFLINE_MAX_AGE_MS) {
      return;
    }
  }
  await precacheOffline();
}

function lastResortOffline() {
  return new Response(
    '<!doctype html><html lang="en-ZA"><meta charset="utf-8">' +
      "<title>You are offline</title>" +
      '<body style="font:16px/1.6 system-ui,sans-serif;margin:0;padding:2.5rem;background:#121829;color:#fff">' +
      "<h1>You are offline.</h1>" +
      "<p>Check your mobile data or Wi-Fi and try again.</p>" +
      "</body></html>",
    {
      status: 503,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    }
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      // Best effort. A failed precache must not stop the worker installing,
      // otherwise one missing asset costs us offline support entirely.
      await precacheOffline().catch(() => {});
      await precacheBrand().catch(() => {});
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Let the browser start the navigation request while this worker boots,
      // instead of paying the startup cost on every page load.
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable().catch(() => {});
      }
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => !CURRENT_CACHES.includes(key))
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

/** Once per worker lifetime, and only after the network has proved reachable. */
let offlineFreshnessChecked = false;

async function handleNavigate(event) {
  try {
    const preload = event.preloadResponse
      ? await event.preloadResponse.catch(() => undefined)
      : undefined;
    const response = preload || (await fetch(event.request));

    if (!offlineFreshnessChecked) {
      offlineFreshnessChecked = true;
      try {
        event.waitUntil(refreshOfflineIfStale().catch(() => {}));
      } catch {
        // waitUntil only works while the event is still active. Housekeeping
        // is never worth turning a good navigation into the offline page.
      }
    }
    return response;
  } catch {
    const cached = await caches.match(OFFLINE_URL, { cacheName: SHELL_CACHE });
    return cached || lastResortOffline();
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (isCacheable(response)) {
    await cache.put(request, response.clone());
    if (cacheName === ASSET_CACHE) await trimCache(cache, MAX_ASSET_ENTRIES);
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Route handlers, server action responses and RSC payloads are per customer.
  // Leave them alone completely: not cached, and never answered with the
  // offline shell, which would corrupt a client side navigation.
  if (url.pathname.startsWith("/api/")) return;
  if (url.searchParams.has("_rsc") || request.headers.has("RSC")) return;

  if (request.mode === "navigate") {
    event.respondWith(handleNavigate(event));
    return;
  }

  // Content hashed build output: a new build produces new names, so a hit is
  // always correct and always free.
  if (!IS_LOCAL && url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }

  // Logos and app icons, small and effectively immutable.
  if (url.pathname.startsWith("/brand/")) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
  }
});
