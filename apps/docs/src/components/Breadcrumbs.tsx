import Link from 'next/link';
import { findNavItem } from '../lib/nav';

/**
 * Home / Section / Page. The section crumb links to that section's
 * first item rather than nowhere, so it's a real step back up, not a
 * label. Renders nothing beyond "Home" for a slug not in NAV — still
 * reachable by URL, just not part of the sidebar's hierarchy.
 */
export function Breadcrumbs({ slug }: { slug: string }) {
  const entry = findNavItem(slug);

  return (
    <nav aria-label="Breadcrumb" className="mb-3 flex items-center gap-1.5 text-sm text-subtle">
      <Link href="/" className="hover:text-fg">
        Home
      </Link>
      {entry && (
        <>
          <Separator />
          {entry.item.slug === entry.section.items[0]?.slug ? (
            <span className="text-fg">{entry.section.title}</span>
          ) : (
            <Link href={`/${entry.section.items[0].slug}`} className="hover:text-fg">
              {entry.section.title}
            </Link>
          )}
        </>
      )}
      {entry && entry.item.slug !== entry.section.items[0]?.slug && (
        <>
          <Separator />
          <span className="text-fg">{entry.item.title}</span>
        </>
      )}
    </nav>
  );
}

function Separator() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-line-strong" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
