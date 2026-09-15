'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ProductSwitcher } from './ProductSwitcher';
import { Search } from './Search';
import { Sidebar } from './Sidebar';
import { ThemeToggle } from './ThemeToggle';

const WWW_URL = process.env.NEXT_PUBLIC_WWW_URL ?? 'http://localhost:3100';
const DASHBOARD_URL = process.env.NEXT_PUBLIC_DASHBOARD_URL ?? 'http://localhost:3000';

/**
 * The top bar: search, the theme toggle, the mobile sidebar drawer, and
 * the external links. One of the few client-side pieces of an otherwise
 * fully static, server-rendered site: every doc page is completely
 * readable with JavaScript disabled; search and the toggle simply won't
 * be available.
 *
 * The container width matches the doc pages' (`max-w-[88rem]`) so the
 * wordmark lines up with the sidebar and the right-hand links line up
 * with the table of contents. It used to be `max-w-6xl`, which left the
 * header visibly narrower than the page under it.
 */
export function DocsNav({ activeSlug }: { activeSlug?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-canvas/90 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[88rem] items-center gap-4 px-4 md:px-6">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle navigation"
          aria-expanded={open}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-raised hover:text-fg md:hidden"
        >
          <MenuIcon />
        </button>

        <Link href="/" className="flex shrink-0 items-center gap-2 text-[15px] font-medium tracking-tight text-fg">
          <RavenMark />
          Livqeno Docs
        </Link>

        <div className="hidden md:block">
          <ProductSwitcher activeSlug={activeSlug} />
        </div>

        <div className="ml-auto flex items-center gap-2 text-sm">
          <Search />
          {/* The wordmark now points at the docs home, so the way back
              to the marketing site is an explicit link rather than a
              surprise on the logo. */}
          <a
            href={WWW_URL}
            className="hidden rounded-md px-2.5 py-1.5 text-[13px] text-muted transition-colors hover:text-fg lg:inline-block"
          >
            Livqeno
          </a>
          <a
            href={DASHBOARD_URL}
            className="hidden rounded-md border border-line px-2.5 py-1.5 text-[13px] font-medium text-fg transition-colors hover:border-line-strong hover:bg-surface sm:inline-block"
          >
            Dashboard
          </a>
          <ThemeToggle />
        </div>
      </div>

      {open && (
        <div
          className="max-h-[calc(100vh-3.5rem)] overflow-y-auto border-t border-line bg-canvas px-4 py-4 md:hidden"
          onClick={() => setOpen(false)}
        >
          <div className="mb-5" onClick={(e) => e.stopPropagation()}>
            <ProductSwitcher activeSlug={activeSlug} />
          </div>
          <Sidebar activeSlug={activeSlug} />
        </div>
      )}
    </header>
  );
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

/**
 * The Livqeno glyph — a monogram L with three concentric arcs opening off
 * its stem: the brand's "signal leaving the stack" idea, and the reason the
 * mark reads as realtime rather than as a bird. Arcs are stroked and the L
 * is filled, both on `currentColor`, so the whole glyph inherits whatever
 * the chip below sets. Master artwork: `assests/livqeno-mark.svg`.
 */
function RavenGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="currentColor" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round">
        <path d="M16.04 12.46A5 5 0 0 1 16.04 19.54" />
        <path d="M18.51 9.99A8.5 8.5 0 0 1 18.51 22.01" />
        <path d="M20.99 7.51A12 12 0 0 1 20.99 24.49" />
      </g>
      <path d="M8 7.5h3.5v13.7H16v3.3H8z" />
    </svg>
  );
}

/**
 * The brand mark: the glyph in electric lime on an ink chip. That pairing
 * is the one place the design system allows lime — never lime sitting on
 * the light canvas — and it inverts with the theme, because `--accent` and
 * `--accent-fg` swap in dark mode.
 */
function RavenMark() {
  return (
    <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-accent text-accent-fg">
      <RavenGlyph className="w-[70%]" />
    </span>
  );
}
