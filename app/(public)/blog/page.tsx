import type { Metadata } from "next";
import Link from "next/link";
import { allPosts } from "@/lib/blog";

export const metadata: Metadata = {
  title: "Blog",
  description:
    "Practical connectivity guides from Needd Connect — no hype, just what works in South Africa.",
  alternates: { canonical: "/blog" },
};

export default async function BlogIndexPage() {
  const posts = await allPosts();
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Blog</h1>
      <p className="mt-2 text-muted-foreground">
        Practical guides, written the way we answer questions on WhatsApp.
      </p>
      <div className="mt-8 space-y-6">
        {posts.map((post) => (
          <Link
            key={post.slug}
            href={`/blog/${post.slug}`}
            className="block rounded-lg border bg-card p-5 transition-shadow hover:shadow-sm"
          >
            <time className="text-xs text-muted-foreground" dateTime={post.date}>
              {new Intl.DateTimeFormat("en-ZA", { dateStyle: "long" }).format(
                new Date(post.date)
              )}
            </time>
            <h2 className="mt-1 text-lg font-semibold">{post.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {post.description}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
