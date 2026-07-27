import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { allPosts } from "@/lib/blog";
import { formatDateLong } from "@/lib/format";
import { PageHeader } from "@/components/public/page-header";
import { Reveal } from "@/components/shared/reveal";

export const metadata: Metadata = {
  title: "Blog",
  description:
    "Practical connectivity guides from Needd Connect, no hype, just what works in South Africa.",
  alternates: { canonical: "/blog" },
  openGraph: {
    title: "Blog | Needd Connect",
    description:
      "Practical connectivity guides, written the way we answer questions on WhatsApp.",
    url: "/blog",
    type: "website",
  },
};

export default async function BlogIndexPage() {
  const posts = await allPosts();
  return (
    <>
      <PageHeader
        size="compact"
        eyebrow="Blog"
        title="Practical guides, no hype"
      >
        <p>
          Written the way we answer questions on WhatsApp: what works in South
          Africa, and what to watch out for.
        </p>
      </PageHeader>

      <div className="mx-auto max-w-3xl px-4 py-14">
        {posts.length === 0 ? (
          <p className="rounded-3xl border border-dashed bg-card/50 p-10 text-center text-sm text-muted-foreground">
            No posts published yet. The first guides are on the way.
          </p>
        ) : (
          <div className="space-y-5">
            {posts.map((post, index) => (
              <Reveal key={post.slug} delay={Math.min(index, 5) * 0.05}>
                <Link
                  href={`/blog/${post.slug}`}
                  className="card-hover group block rounded-3xl border bg-card p-6"
                >
                  <time
                    className="text-xs uppercase tracking-wider text-muted-foreground"
                    dateTime={post.date}
                  >
                    {formatDateLong(post.date)}
                  </time>
                  <h2 className="mt-2 text-lg font-semibold tracking-tight">
                    {post.title}
                  </h2>
                  <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                    {post.description}
                  </p>
                  <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
                    Read the guide
                    <ArrowRight
                      className="size-3.5 transition-transform group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </span>
                </Link>
              </Reveal>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
