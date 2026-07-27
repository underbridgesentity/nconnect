import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname),
  },
  images: {
    /*
     * AVIF first, WebP second. Catalogue photographs are the heaviest thing a
     * customer downloads on the public site, and most of them arrive on a
     * capped South African mobile package, so the smaller encoding is worth
     * the extra transform cost. Browsers that support neither still get the
     * original.
     */
    formats: ["image/avif", "image/webp"],
    /*
     * Product photography lives in the public `catalogue` bucket on Supabase
     * Storage (lib/storage.ts). Without this allowlist next/image refuses the
     * host and the only way to render one is a bare <img>, which ships the
     * full-resolution upload to a phone. The pattern is deliberately narrow:
     * only the public object path, never `/object/sign/` (compliance and
     * customer documents), so a short-lived signed URL can never be pulled
     * through the image optimiser and cached at the edge.
     */
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

export default nextConfig;
