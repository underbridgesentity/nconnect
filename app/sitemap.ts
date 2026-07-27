import type { MetadataRoute } from "next";
import {
  publishedPlans,
  publishedHardware,
  bundlesWithItems,
} from "@/lib/domain/catalogue";
import { allPosts } from "@/lib/blog";
import { appUrl } from "@/lib/config";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = appUrl();
  const [plans, hardware, bundles, posts] = await Promise.all([
    publishedPlans(),
    publishedHardware(),
    bundlesWithItems({ publishedOnly: true }),
    allPosts(),
  ]);

  const staticPages = [
    "",
    "/internet",
    "/fibre",
    "/voip",
    "/sim-data",
    "/hardware",
    "/bundles",
    "/coverage",
    "/about",
    "/contact",
    "/help",
    "/blog",
    "/legal/privacy",
    "/legal/popia",
    "/legal/terms",
    "/legal/rica",
  ].map((path) => ({
    url: `${base}${path}`,
    changeFrequency: "weekly" as const,
    priority: path === "" ? 1 : 0.7,
  }));

  return [
    ...staticPages,
    ...plans.map((p) => ({
      url: `${base}/plans/${p.slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
    ...hardware.map((h) => ({
      url: `${base}/hardware/${h.sku}`,
      changeFrequency: "weekly" as const,
      priority: 0.5,
    })),
    ...bundles.map((b) => ({
      url: `${base}/bundles/${b.slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
    ...posts.map((post) => ({
      url: `${base}/blog/${post.slug}`,
      lastModified: new Date(post.date),
      changeFrequency: "monthly" as const,
      priority: 0.4,
    })),
  ];
}
