'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ProductSwitcher } from './ProductSwitcher';
import { Search } from './Search';
import { Sidebar } from './Sidebar';
import { ThemeToggle } from './ThemeToggle';

const WWW_URL = process.env.NEXT_PUBLIC_WWW_URL ?? 'http://localhost:3100';
const DASHBOARD_URL = process.env.NEXT_PUBLIC_DASHBOARD_URL ?? 'http://localhost:3000';
// The repository, replacing a Discord invite as the one community link
// here and matching the landing page's nav. Note it 404s until the repo
// is made public — see docs/production/readiness-audit.md.
const GITHUB_REPO_URL = 'https://github.com/atulsinghhhh/Raven';

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
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noreferrer noopener"
            aria-label="GitHub repository"
            className="inline-flex size-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-raised hover:text-fg"
          >
            <GitHubIcon />
          </a>
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

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-4" aria-hidden="true">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.1 3.29 9.42 7.86 10.95.58.1.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.04-.72.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.43-2.7 5.4-5.27 5.68.42.36.78 1.07.78 2.15 0 1.55-.01 2.8-.01 3.18 0 .31.21.67.8.56A10.52 10.52 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}
