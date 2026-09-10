'use client';

import Link from 'next/link';
import { useState } from 'react';
import { NAV, type NavItem } from '../lib/nav';

/**
 * The documentation tree, always global.
 *
 * This used to swap itself out inside a product area (`/rtc/*` and
 * friends) to show only that product's pages, on the theory that it
 * should feel like a dedicated product site. In practice it stranded the
 * reader: from RTC → Authentication there was no way to reach Chat or
 * the SDK reference without going back to the home page first, and the
 * only clue was a small "← All Livqeno docs" link. The tree is now the
 * same everywhere, so the whole map is always one click away.
 *
 * Sections collapse, because fourteen of them fully expanded is far more
 * than fits on screen. The one holding the current page starts open.
 */
export function Sidebar({ activeSlug }: { activeSlug?: string }) {
  // Manual open/closed choices, keyed by section title. A section with
  // no entry here falls back to "open if it holds the current page",
  // which is what makes navigating to a new area reveal it. Holding the
  // overrides here rather than in per-section state matters: a section
  // component's useState would capture `containsActive` once and then
  // ignore later navigations.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  function toggle(title: string, currentlyOpen: boolean) {
    setOverrides((prev) => ({ ...prev, [title]: !currentlyOpen }));
  }

  return (
    <nav aria-label="Documentation" className="text-sm">
      <ul className="flex flex-col gap-0.5">
        {NAV.map((section) => {
          const containsActive = section.items.some((item) => item.slug === activeSlug);
          const open = overrides[section.title] ?? containsActive;

          return (
            <li key={section.title}>
              <button
                type="button"
                onClick={() => toggle(section.title, open)}
                aria-expanded={open}
                className={`mono-label flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[11px] transition-colors ${
                  containsActive ? 'text-accent-text' : 'text-muted hover:text-fg'
                }`}
              >
                {section.title}
                <ChevronIcon className={`size-3 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
              </button>

              {open && (
                <ul className="mb-3 ml-2 flex flex-col border-l border-line">
                  <NavItems items={section.items} activeSlug={activeSlug} />
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function NavItems({ items, activeSlug }: { items: NavItem[]; activeSlug?: string }) {
  return (
    <>
      {items.map((item) => {
        const active = item.slug === activeSlug;
        return (
          <li key={item.slug}>
            {/*
              The active page is marked by a rule on the tree line and a
              colour change, not a filled block. At this density a solid
              accent panel behind one row in a list of eighty is the
              loudest thing on the page.
            */}
            <Link
              href={`/${item.slug}`}
              aria-current={active ? 'page' : undefined}
              className={`-ml-px block border-l-2 py-1.5 pl-3 transition-colors ${
                active
                  ? 'border-accent font-medium text-accent-text'
                  : 'border-transparent text-muted hover:border-line-strong hover:text-fg'
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
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
