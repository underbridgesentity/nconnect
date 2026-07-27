import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/config";

export default function robots(): MetadataRoute.Robots {
  const base = appUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/sales", "/portal", "/api", "/q/", "/signup"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
