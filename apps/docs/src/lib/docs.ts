import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypePrettyCode from 'rehype-pretty-code';
import rehypeSlug from 'rehype-slug';
import rehypeStringify from 'rehype-stringify';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { NAV } from './nav';

const CONTENT_DIR = path.join(process.cwd(), 'content');

export interface DocFrontmatter {
  title: string;
  description?: string;
}

export interface DocPage extends DocFrontmatter {
  slug: string;
  html: string;
}

function filePath(slug: string): string {
  return path.join(CONTENT_DIR, `${slug}.md`);
}

/** Every slug that has a content file — the full set `generateStaticParams` renders. */
export function getAllSlugs(): string[] {
  const slugs: string[] = [];
  const walk = (dir: string, prefix: string[]) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), [...prefix, entry.name]);
      } else if (entry.name.endsWith('.md')) {
        slugs.push([...prefix, entry.name.replace(/\.md$/, '')].join('/'));
      }
    }
  };
  walk(CONTENT_DIR, []);
  return slugs;
}

/**
 * Compiles one page's Markdown to HTML.
 *
 * `rehype-pretty-code` (Shiki under the hood) does syntax highlighting at
 * build time, server-side — the shipped page carries pre-colored `<span>`s
 * and zero client-side highlighting JS, rather than a client bundle that
 * has to load a grammar and re-parse every code block after hydration.
 */
export async function getDoc(slug: string): Promise<DocPage | undefined> {
  const file = filePath(slug);
  if (!fs.existsSync(file)) {
    return undefined;
  }

  const raw = fs.readFileSync(file, 'utf8');
  const { data, content } = matter(raw);
  const frontmatter = data as DocFrontmatter;

  const processed = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: false })
    .use(rehypeSlug)
    .use(rehypeAutolinkHeadings, { behavior: 'wrap' })
    .use(rehypePrettyCode, {
      theme: { light: 'github-light', dark: 'github-dark' },
      keepBackground: false,
    })
    .use(rehypeStringify)
    .process(content);

  return { slug, title: frontmatter.title, description: frontmatter.description, html: String(processed) };
}

/**
 * Every slug NAV points to must have a content file, and vice versa is
 * not required (a file can exist without being in the sidebar yet) — but
 * a dead sidebar link is always a bug. Called once during the build; see
 * app/layout.tsx.
 */
export function assertNavMatchesContent(): void {
  const existing = new Set(getAllSlugs());
  const missing = NAV.flatMap((section) => section.items)
    .map((item) => item.slug)
    .filter((slug) => !existing.has(slug));

  if (missing.length > 0) {
    throw new Error(`Docs nav references missing content file(s): ${missing.join(', ')}`);
  }
}
