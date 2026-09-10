import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Breadcrumbs } from '../../components/Breadcrumbs';
import { DocsNav } from '../../components/DocsNav';
import { Sidebar } from '../../components/Sidebar';
import { TableOfContents } from '../../components/TableOfContents';
import { getAllSlugs, getDoc } from '../../lib/docs';
import { getAdjacent } from '../../lib/nav';

export function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug: slug.split('/') }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug: slugParts } = await params;
  const slug = slugParts.join('/');
  const doc = await getDoc(slug);
  if (!doc) return {};

  return {
    title: doc.title,
    description: doc.description,
    alternates: { canonical: `/${slug}` },
    openGraph: {
      title: doc.title,
      description: doc.description,
      type: 'article',
      url: `/${slug}`,
    },
  };
}

export default async function DocPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug: slugParts } = await params;
  const slug = slugParts.join('/');
  const doc = await getDoc(slug);

  if (!doc) {
    notFound();
  }

  const { prev, next } = getAdjacent(slug);

  return (
    <>
      <DocsNav activeSlug={slug} />
      <div className="mx-auto flex max-w-[88rem] gap-8 px-4 py-8 md:px-6 lg:gap-12 xl:gap-16">
        <aside className="hidden w-56 shrink-0 lg:block">
          <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pb-8">
            <Sidebar activeSlug={slug} />
          </div>
        </aside>

        {/*
          A measured column. Prose set to the full width of a 1400px
          viewport runs past 110 characters a line, which is roughly
          double what is comfortable to read; capping it keeps the
          measure sane on wide screens without shrinking the code blocks
          on narrow ones.
        */}
        <main className="min-w-0 max-w-3xl flex-1">
          <Breadcrumbs slug={slug} />
          <h1 className="display text-4xl text-fg">{doc.title}</h1>
          {doc.description && <p className="mt-4 text-lg leading-relaxed text-muted">{doc.description}</p>}

          <article className="prose mt-10 border-t border-line pt-10">{doc.content}</article>

          <nav
            aria-label="Previous and next page"
            className="mt-16 grid gap-3 border-t border-line pt-8 sm:grid-cols-2"
          >
            {prev ? (
              <Link
                href={`/${prev.slug}`}
                className="group rounded-md border border-line p-4 transition-colors hover:border-line-strong hover:bg-surface-raised"
              >
                <span className="mono-label block text-[11px] text-muted">&larr; Previous</span>
                <span className="mt-1.5 block text-sm font-medium text-fg">{prev.title}</span>
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link
                href={`/${next.slug}`}
                className="group rounded-md border border-line p-4 text-right transition-colors hover:border-line-strong hover:bg-surface-raised sm:col-start-2"
              >
                <span className="mono-label block text-[11px] text-muted">Next &rarr;</span>
                <span className="mt-1.5 block text-sm font-medium text-fg">{next.title}</span>
              </Link>
            ) : (
              <span />
            )}
          </nav>
        </main>

        <aside className="hidden w-56 shrink-0 xl:block">
          <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pb-8">
            <TableOfContents headings={doc.headings} />
          </div>
        </aside>
      </div>
    </>
  );
}
