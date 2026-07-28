import type { MetadataRoute } from "next";

/**
 * Web app manifest (spec §3 PWA). The installable surface is the customer
 * portal, so start_url points there, but scope stays at the root: help,
 * coverage and the legal pages are all linked from inside the portal and must
 * open in the app window rather than kicking the customer out to a browser.
 *
 * `id` is pinned to the current start_url. It is the identity an installed app
 * is keyed on, so it must never change once anyone has installed, even if
 * start_url later moves.
 *
 * Orientation is deliberately left at "any": WCAG 2.1 SC 1.3.4 asks that
 * content not be locked to one display orientation, and plenty of people read
 * an invoice with the phone on its side.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/portal",
    name: "Needd Connect",
    short_name: "Needd",
    description:
      "Your Needd Connect services, invoices and support, one provider, one bill.",
    lang: "en-ZA",
    dir: "ltr",
    start_url: "/portal",
    scope: "/",
    display: "standalone",
    orientation: "any",
    categories: ["business", "finance", "utilities"],
    // Matches --background in globals.css, so the splash screen hands over to
    // the first paint without a flash.
    background_color: "#fafaf9",
    theme_color: "#136fb0",
    icons: [
      {
        src: "/brand/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      /*
       * Android crops a home-screen icon to whatever shape the launcher uses,
       * and anything outside the central 80% circle can be cut off. Without a
       * maskable entry the platform falls back to the "any" icon on a white
       * plate it draws itself, which clips the mark. This one is drawn with
       * the N inside the safe zone.
       */
      {
        src: "/brand/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    // Long-press the home screen icon. Every target is a real portal route.
    shortcuts: [
      {
        name: "Billing and invoices",
        short_name: "Billing",
        description: "Your balance, invoices and payments.",
        url: "/portal/billing",
      },
      {
        name: "My services",
        short_name: "Services",
        description: "Line status, data usage and support requests.",
        url: "/portal/services",
      },
      {
        name: "Get help",
        short_name: "Help",
        description: "Talk to a person at Needd Connect.",
        url: "/portal/help",
      },
    ],
  };
}
