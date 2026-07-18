import "server-only";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";

const BLOG_DIR = path.join(process.cwd(), "content/blog");

export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  date: string;
  author: string;
  content: string;
}

export async function allPosts(): Promise<BlogPost[]> {
  let files: string[] = [];
  try {
    files = (await readdir(BLOG_DIR)).filter((f) => f.endsWith(".mdx"));
  } catch {
    return [];
  }
  const posts = await Promise.all(
    files.map(async (file) => {
      const raw = await readFile(path.join(BLOG_DIR, file), "utf8");
      const { data, content } = matter(raw);
      return {
        slug: file.replace(/\.mdx$/, ""),
        title: String(data.title ?? file),
        description: String(data.description ?? ""),
        date: String(data.date ?? ""),
        author: String(data.author ?? "Needd Connect"),
        content,
      };
    })
  );
  return posts.sort((a, b) => b.date.localeCompare(a.date));
}

export async function postBySlug(slug: string): Promise<BlogPost | null> {
  const posts = await allPosts();
  return posts.find((p) => p.slug === slug) ?? null;
}
