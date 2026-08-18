import Link from 'next/link';
import { NAV } from '../lib/nav';

export function Sidebar({ activeSlug }: { activeSlug?: string }) {
  return (
    <nav aria-label="Documentation" className="text-sm">
      {NAV.map((section) => (
        <div key={section.title} className="mb-6">
          <h3 className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-subtle">
            {section.title}
          </h3>
          <ul>
            {section.items.map((item) => {
              const active = item.slug === activeSlug;
              return (
                <li key={item.slug}>
                  <Link
                    href={`/${item.slug}`}
                    className={`block rounded-md px-2 py-1.5 transition-colors ${
                      active
                        ? 'bg-accent-subtle font-medium text-accent-text'
                        : 'text-muted hover:bg-surface-raised hover:text-fg'
                    }`}
                  >
                    {item.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
