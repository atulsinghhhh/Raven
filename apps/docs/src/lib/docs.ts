import fs from 'node:fs';
import path from 'node:path';
import type { ReactElement } from 'react';
import matter from 'gray-matter';
import { compileMDX } from 'next-mdx-remote/rsc';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypePrettyCode from 'rehype-pretty-code';
import rehypeSlug from 'rehype-slug';
import rehypeStringify from 'rehype-stringify';
import remarkGfm from 'remark-gfm';
import remarkMdx from 'remark-mdx';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import type { Node, Parent } from 'unist';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import { mdxComponents } from '../components/mdx';
import { NAV } from './nav';

const CONTENT_DIR = path.join(process.cwd(), 'content');

export interface DocFrontmatter {
  title: string;
  description?: string;
}

export interface DocHeading {
  id: string;
  text: string;
  level: number;
}

export interface DocPage extends DocFrontmatter {
  slug: string;
  /** Compiled MDX, already rendered to a React element: render it directly, e.g. `{doc.content}`. */
  content: ReactElement;
  headings: DocHeading[];
  /**
   * The page rendered to plain HTML once, purely for the search indexer
   * (`search.ts`): never sent to the browser. Built by a *separate*,
   * React-free pipeline (remark/rehype only) instead of rendering
   * `content` to a string: Next 16 refuses to let a Server Component's
   * module graph import `react-dom/server` at all. Instead `<Tabs>`/
   * `<Tab>` are unwrapped to their bare children at the AST level
   * (`remarkUnwrapJsx`) before the normal remark→rehype→HTML conversion
   *: every SDK tab's code still gets indexed, its button label doesn't.
   */
  searchHtml: string;
}

const MDX_OPTIONS = {
  remarkPlugins: [remarkGfm],
  rehypePlugins: [
    rehypeSlug,
    [rehypeAutolinkHeadings, { behavior: 'wrap' }],
    [
      rehypePrettyCode,
      { theme: { light: 'github-light', dark: 'github-dark' }, keepBackground: false },
    ],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- rehype plugin tuples aren't typed generically by CompileOptions
  ] as any,
};

function filePath(slug: string): string {
  return path.join(CONTENT_DIR, `${slug}.md`);
}

/** Every slug that has a content file: the full set `generateStaticParams` renders. */
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
 * Compiles one page's Markdown/MDX and pre-renders a plain-HTML copy for
 * search. `rehype-pretty-code` (Shiki under the hood) still does syntax
 * highlighting at build/request time, server-side, in both pipelines.
 */
export async function getDoc(slug: string): Promise<DocPage | undefined> {
  const file = filePath(slug);
  if (!fs.existsSync(file)) {
    return undefined;
  }

  const raw = fs.readFileSync(file, 'utf8');
  const { data, content: body } = matter(raw);
  const frontmatter = data as DocFrontmatter;

  const [{ content }, searchHtml] = await Promise.all([
    compileMDX({ source: body, options: { mdxOptions: MDX_OPTIONS }, components: mdxComponents }),
    renderSearchHtml(body),
  ]);

  return {
    slug,
    title: frontmatter.title,
    description: frontmatter.description,
    content,
    headings: extractHeadings(searchHtml),
    searchHtml,
  };
}

/**
 * Replaces every `<Tabs>`/`<Tab>` JSX node with its own children,
 * dropping the wrapper and its props (component name, `title="Web"`
 * attribute) entirely. `remark-mdx` parses the JSX into
 * `mdxJsxFlowElement`/`mdxJsxTextElement` nodes whose `children` are
 * still ordinary mdast: unwrapping just splices those children in the
 * parent's place so plain remark-rehype can take it from there as if the
 * component had never been there.
 */
function remarkUnwrapJsx() {
  return (tree: Node) => {
    visit(tree, (node: Node, index: number | undefined, parent: Parent | undefined) => {
      if (!parent || index === undefined) return;
      if (node.type !== 'mdxJsxFlowElement' && node.type !== 'mdxJsxTextElement') return;

      const children = 'children' in node && Array.isArray(node.children) ? node.children : [];
      parent.children.splice(index, 1, ...children);
      // Re-visit starting at the same index: the spliced-in children may
      // themselves need unwrapping (a Tab nested directly in a Tabs).
      return index;
    });
  };
}

async function renderSearchHtml(content: string): Promise<string> {
  const processed = await unified()
    .use(remarkParse)
    .use(remarkMdx)
    .use(remarkGfm)
    .use(remarkUnwrapJsx)
    .use(remarkRehype, { allowDangerousHtml: false })
    .use(rehypeSlug)
    .use(rehypeAutolinkHeadings, { behavior: 'wrap' })
    .use(rehypePrettyCode, {
      theme: { light: 'github-light', dark: 'github-dark' },
      keepBackground: false,
    })
    .use(rehypeStringify)
    .process(content);

  return String(processed);
}

/**
 * Pulls h2/h3 out of the rendered HTML for the "On this page" rail.
 *
 * Regex over the compiled output, not another tree traversal;
 * the ids are already there (rehype-slug added them), and the shape is
 * known and machine-generated.
 */
function extractHeadings(html: string): DocHeading[] {
  const headings: DocHeading[] = [];
  const pattern = /<h([23])[^>]*\sid="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/g;

  for (const match of html.matchAll(pattern)) {
    const [, level, id, inner] = match;
    const text = inner.replace(/<|>/g, '').trim();
    if (text) {
      headings.push({ id, text, level: Number(level) });
    }
  }

  return headings;
}

/**
 * Every slug NAV points to must have a content file, and vice versa is
 * not required (a file can exist without being in the sidebar yet), but
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
