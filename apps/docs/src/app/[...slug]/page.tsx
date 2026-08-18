import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DocsNav } from '../../components/DocsNav';
import { Sidebar } from '../../components/Sidebar';
import { getAllSlugs, getDoc } from '../../lib/docs';
import { getAdjacent } from '../../lib/nav';

export function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug: slug.split('/') }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const doc = await getDoc(slug.join('/'));
  if (!doc) return {};
  return { title: doc.title, description: doc.description };
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
      <div className="mx-auto flex max-w-6xl gap-10 px-4 py-8 md:px-6 md:py-10">
        <aside className="hidden w-56 shrink-0 md:block">
          <div className="sticky top-20">
            <Sidebar activeSlug={slug} />
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <article className="prose" dangerouslySetInnerHTML={{ __html: doc.html }} />

          <nav className="mt-12 flex items-center justify-between gap-4 border-t border-line pt-6 text-sm">
            {prev ? (
              <Link href={`/${prev.slug}`} className="text-muted transition-colors hover:text-fg">
                ← {prev.title}
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link href={`/${next.slug}`} className="text-right text-muted transition-colors hover:text-fg">
                {next.title} →
              </Link>
            ) : (
              <span />
            )}
          </nav>
        </main>
      </div>
    </>
  );
}
