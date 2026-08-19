'use client';

import Link from 'next/link';
import { useState } from 'react';
import { NAV, productForSlug, type NavItem, type NavSection } from '../lib/nav';

/**
 * Context-aware: inside a product area (`/rtc/*`, `/chat/*`,
 * `/live-streaming/*`) this shows ONLY that product's section, so the
 * reader feels like they're in a dedicated product docs area rather
 * than browsing all of Raven. Everywhere else (Getting Started, SDKs,
 * Reference, ...) it shows the full site nav as a collapsed-by-default
 * accordion — clicking "RTC" reveals Overview and the rest of that
 * section; every other section stays collapsed until clicked. The
 * section containing the current page starts open, so landing on a
 * page never hides its own place in the nav.
 */
export function Sidebar({ activeSlug }: { activeSlug?: string }) {
  const product = activeSlug ? productForSlug(activeSlug) : undefined;

  if (product) {
    const section = NAV.find((s) => s.product === product)!;
    return (
      <div className="text-sm">
        <ul>
          <NavItems items={section.items} activeSlug={activeSlug} />
        </ul>
        <Link href="/" className="mt-4 block px-2 text-xs text-subtle hover:text-fg">
          ← All Raven docs
        </Link>
      </div>
    );
  }

  return (
    <nav aria-label="Documentation" className="text-sm">
      {NAV.map((section) => (
        <CollapsibleSection key={section.title} section={section} activeSlug={activeSlug} />
      ))}
    </nav>
  );
}

function CollapsibleSection({ section, activeSlug }: { section: NavSection; activeSlug?: string }) {
  const containsActive = section.items.some((item) => item.slug === activeSlug);
  const [open, setOpen] = useState(containsActive);

  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-subtle transition-colors hover:text-fg"
      >
        {section.title}
        <ChevronIcon className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <ul className="mb-5 mt-1">
          <NavItems items={section.items} activeSlug={activeSlug} />
        </ul>
      )}
    </div>
  );
}

function NavItems({ items, activeSlug }: { items: NavItem[]; activeSlug?: string }) {
  return (
    <>
      {items.map((item) => {
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
    </>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
