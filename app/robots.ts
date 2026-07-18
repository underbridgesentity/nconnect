import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/sales", "/portal", "/api", "/q/", "/signup"],
      },
    ],
    sitemap: `${appUrl}/sitemap.xml`,
  };
}
