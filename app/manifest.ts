import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Needd Connect",
    short_name: "Needd",
    description:
      "Your Needd Connect services, invoices and support, one provider, one bill.",
    start_url: "/portal",
    scope: "/",
    display: "standalone",
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
    ],
  };
}
