'use client';

import { useEffect, useState } from 'react';

export interface Heading {
  id: string;
  text: string;
  level: number;
}

/**
 * The "On this page" rail.
 *
 * Headings are extracted server-side (see lib/docs.ts) instead of by
 * querying the DOM here, so the list renders in the initial HTML instead
 * of popping in after hydration. This component's only client-side job
 * is tracking which heading is currently in view.
 */
export function TableOfContents({ headings }: { headings: Heading[] }) {
  const [activeId, setActiveId] = useState<string>('');

  useEffect(() => {
    if (headings.length === 0 || typeof IntersectionObserver === 'undefined') {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        // The topmost heading currently intersecting wins: without the
        // sort, whichever entry the observer happened to report last
        // would, which flickers when several cross the boundary together.
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

        if (visible[0]) {
          setActiveId(visible[0].target.id);
        }
      },
      { rootMargin: '-80px 0px -70% 0px' },
    );

    for (const heading of headings) {
      const el = document.getElementById(heading.id);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [headings]);

  if (headings.length < 2) {
    // A single-heading page has nothing to navigate between.
    return null;
  }

  return (
    <nav aria-label="On this page" className="text-sm">
      <h2 className="mono-label mb-3 text-[11px] text-muted">On this page</h2>
      <ul className="space-y-1 border-l border-line">
        {headings.map((heading) => (
          <li key={heading.id}>
            <a
              href={`#${heading.id}`}
              className={`-ml-px block border-l-2 py-1.5 transition-colors ${heading.level === 3 ? 'pl-6' : 'pl-3'} ${
                activeId === heading.id
                  ? 'border-accent font-medium text-accent-text'
                  : 'border-transparent text-muted hover:border-line-strong hover:text-fg'
              }`}
            >
              {heading.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
