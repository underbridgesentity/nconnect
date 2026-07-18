"use client";

import { useEffect } from "react";

/** Registers the minimal service worker (installable portal, offline shell). */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.error("sw registration failed:", err);
      });
    }
  }, []);
  return null;
}
