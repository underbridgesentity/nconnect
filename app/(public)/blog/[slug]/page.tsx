import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MDXRemote } from "next-mdx-remote/rsc";
import { allPosts, postBySlug } from "@/lib/blog";
import { formatDateLong } from "@/lib/format";
import { JsonLd, breadcrumbJsonLd } from "@/components/public/json-ld";
import { PageHeader } from "@/components/public/page-header";
import { PillLink } from "@/components/public/pill";
import { Prose } from "@/components/public/prose";
import { appUrl } from "@/lib/config";

export async function generateStaticParams() {
  const posts = await allPosts();
  return posts.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await postBySlug(slug);
  if (!post) return { title: "Post not found" };
  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: `/blog/${post.slug}` },
    authors: [{ name: post.author }],
    openGraph: {
      title: post.title,
      description: post.description,
      url: `/blog/${post.slug}`,
      type: "article",
      publishedTime: post.date,
      authors: [post.author],
    },
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await postBySlug(slug);
  if (!post) notFound();

  const base = appUrl();

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BlogPosting",
          headline: post.title,
          description: post.description || undefined,
          datePublished: post.date || undefined,
          author: { "@type": "Person", name: post.author },
          publisher: {
            "@type": "Organization",
            name: "Needd Connect",
            logo: {
              "@type": "ImageObject",
              url: `${base}/brand/icon-512.png`,
            },
          },
          mainEntityOfPage: {
            "@type": "WebPage",
            "@id": `${base}/blog/${post.slug}`,
          },
        }}
      />
      <JsonLd
        data={breadcrumbJsonLd(base, [
          { name: "Home", path: "/" },
          { name: "Blog", path: "/blog" },
          { name: post.title, path: `/blog/${post.slug}` },
        ])}
      />

      <PageHeader
        size="compact"
        eyebrow={
          <>
            {post.author}
            {post.date ? ` | ${formatDateLong(post.date)}` : ""}
          </>
        }
        title={post.title}
        breadcrumb={[
          { label: "Home", href: "/" },
          { label: "Blog", href: "/blog" },
        ]}
      >
        {post.description ? <p>{post.description}</p> : null}
      </PageHeader>

      <article className="mx-auto max-w-3xl px-4 py-14">
        <Prose
          flow="flow"
          className="text-[17px] leading-[1.75] [&_h2]:text-xl"
        >
          <MDXRemote source={post.content} />
        </Prose>
        <div className="mt-12 flex flex-wrap items-center gap-4 rounded-3xl border bg-card p-6">
          <p className="flex-1 text-sm leading-6 text-foreground/80">
            Wondering how this applies at your address? We check coverage
            before you pay a cent.
          </p>
          <PillLink href="/coverage">Check coverage</PillLink>
          <PillLink href="/blog" variant="outline">
            More guides
          </PillLink>
        </div>
      </article>
    </>
  );
}
