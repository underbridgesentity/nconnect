import type { Metadata } from "next";
import { RefreshCw, WifiOff } from "lucide-react";
import { pillClass } from "@/components/public/pill";

export const metadata: Metadata = {
  title: "You are offline",
  robots: { index: false, follow: false },
};

/**
 * The offline shell, served from the service worker cache (public/sw.js) when
 * a navigation cannot reach the network.
 *
 * Two constraints shape this page and neither is obvious:
 *
 * 1. It renders with no server, so everything on it must already be in the
 *    cache. That is why the logo is a plain <img> pointed straight at
 *    /brand/logo-white.png: next/image would request /_next/image?url=..., a
 *    URL the service worker has never seen, and the customer would meet a
 *    broken image on the one page that exists to reassure them.
 * 2. It renders with no guarantee that React has hydrated, because the page
 *    chunk may not have been cached before the connection dropped. So the
 *    retry is a real link that works with no JavaScript at all, upgraded by a
 *    tiny inline script (which ships inside this HTML, and therefore always
 *    runs) into a reload of whatever page the customer was actually trying to
 *    open.
 */
export default function OfflinePage() {
  return (
    <div
      data-surface="ink"
      className="flex min-h-dvh flex-col bg-[#121829] text-white"
    >
      <header className="mx-auto flex w-full max-w-3xl items-center px-4 py-6">
        {/* eslint-disable-next-line @next/next/no-img-element -- must resolve from the service worker cache, see note above */}
        <img
          src="/brand/logo-white.png"
          alt="Needd Connect"
          width={140}
          height={21}
        />
      </header>

      <main
        id="main-content"
        className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-4 py-12"
      >
        <span className="flex size-14 items-center justify-center rounded-2xl bg-white/10">
          <WifiOff className="size-7 text-sky-400" aria-hidden />
        </span>

        <h1 className="mt-6 text-3xl font-bold tracking-tight sm:text-4xl">
          You are offline.
        </h1>
        <p className="mt-4 max-w-xl text-lg text-white/70">
          Your phone cannot reach us right now, which we admit is awkward for an
          internet company. Nothing you had already done has been lost.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          {/*
           * Plain anchors, not next/link, and deliberately so: a soft client
           * navigation can be answered out of the router cache without ever
           * touching the network, which is the opposite of what someone
           * pressing "Try again" is asking for. A full document request is
           * what gives the service worker another go at the connection.
           */}
          {/* eslint-disable @next/next/no-html-link-for-pages */}
          <a data-retry="" href="/portal" className={pillClass("primary")}>
            <RefreshCw className="size-4" aria-hidden />
            Try again
          </a>
          <a href="/portal/help" className={pillClass("ink")}>
            Help and contact details
          </a>
          {/* eslint-enable @next/next/no-html-link-for-pages */}
        </div>

        <div className="mt-12 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          {/* Uppercased in CSS, not in the text, so screen readers say the
              words instead of spelling them out. */}
          <h2 className="text-sm font-semibold uppercase tracking-wide text-white/50">
            Worth checking
          </h2>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-white/80">
            <li>
              Mobile data or Wi-Fi may be switched off, or the data bundle may
              be finished.
            </li>
            <li>
              If the power is out in your area, your router is down and the
              nearest tower may be running on battery.
            </li>
            <li>
              Moving to a window or stepping outside is often enough on LTE and
              5G.
            </li>
          </ul>
          <p className="mt-4 text-sm leading-6 text-white/60">
            If you were paying an invoice or sending a form when the connection
            dropped, it did not go through. Nothing was charged, and you can
            send it again once you are back online.
          </p>
        </div>
      </main>

      {/*
       * Progressive enhancement, not hydration: this runs from the cached HTML
       * even when the page chunk never downloaded. With no JavaScript the link
       * above still goes somewhere useful.
       */}
      <script
        dangerouslySetInnerHTML={{
          __html:
            "document.querySelectorAll('[data-retry]').forEach(function(el){el.addEventListener('click',function(ev){ev.preventDefault();location.reload()})})",
        }}
      />
    </div>
  );
}
