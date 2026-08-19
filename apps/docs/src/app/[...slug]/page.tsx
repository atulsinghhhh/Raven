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
      <div className="mx-auto flex max-w-[88rem] gap-8 px-4 py-8 md:px-6 lg:gap-12">
        <aside className="hidden w-56 shrink-0 lg:block">
          <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pb-8">
            <Sidebar activeSlug={slug} />
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <Breadcrumbs slug={slug} />
          <h1 className="text-3xl font-semibold tracking-tight text-fg">{doc.title}</h1>
          {doc.description && <p className="mt-2 text-lg text-muted">{doc.description}</p>}

          <article
            className="prose mt-8 border-t border-line pt-8"
            dangerouslySetInnerHTML={{ __html: doc.html }}
          />

          <nav className="mt-14 grid gap-3 border-t border-line pt-6 sm:grid-cols-2">
            {prev ? (
              <Link
                href={`/${prev.slug}`}
                className="rounded-lg border border-line p-4 transition-colors hover:border-accent-line hover:bg-surface-raised"
              >
                <span className="block text-xs text-subtle">Previous</span>
                <span className="mt-0.5 block font-medium text-fg">{prev.title}</span>
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link
                href={`/${next.slug}`}
                className="rounded-lg border border-line p-4 text-right transition-colors hover:border-accent-line hover:bg-surface-raised sm:col-start-2"
              >
                <span className="block text-xs text-subtle">Next</span>
                <span className="mt-0.5 block font-medium text-fg">{next.title}</span>
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
