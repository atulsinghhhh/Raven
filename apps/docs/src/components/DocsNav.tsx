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
          Raven Docs
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
            Raven
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
 * The Raven glyph — the circuit-winged raven head, traced from the master
 * artwork in `assests/logo.png`. A single path with `evenodd` fill, so the
 * eye and the two wing-trace nodes stay punched out rather than needing
 * their own shapes. The viewBox keeps the artwork's natural 32:20.5, so a
 * square box letterboxes the mark instead of squashing it.
 */
function RavenGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 20.53" className={className} fill="currentColor" fillRule="evenodd" aria-hidden="true">
      <path d="M18.52 0L20.21 0.03L22.03 0.38L23.34 0.82L25.06 1.75L25.88 2.37L26.78 3.24L27.65 4.36L28.32 4.7L29.28 5.36L30.49 6.46L31.38 7.7L31.86 8.7L32 9.16L31.94 9.2L31.34 8.89L30.07 8.41L28.15 7.93L26.48 7.79L25.45 8L24.8 8.38L24.45 8.7L24.14 9.11L23.86 9.66L23.48 10.93L23.31 12.4L23.31 13.14L23.25 13.15L17.58 5.67L16.93 4.85L16.4 4.36L15.89 4.05L15.06 3.81L10.51 3.8L11.03 3.26L12.16 2.37L13.02 1.79L14.33 1.06L16.28 0.34L17.42 0.1ZM21.69 3.12L21.67 3.18L23.46 5.29L25.58 4.66L25.57 4.6L25.09 4.39ZM0.21 5.53L15.2 5.53L16.79 7.42L23.45 15.8L24.21 16.97L24.86 18.17L25.51 19.61L25.82 20.52L18.19 15.28L8.94 15.28L8.8 15.18L6.94 13.07L6.94 12.94L14.24 12.94L14.57 13.32L14.94 13.56L15.29 13.67L15.79 13.67L16.37 13.42L16.79 13L16.93 12.73L17.03 12.32L17 11.89L16.86 11.51L16.62 11.17L16.3 10.92L15.92 10.75L15.36 10.71L14.77 10.92L14.27 11.43L5.33 11.43L4.29 10.33L3.4 9.3L3.36 9.18L9.81 9.17L10.1 9.51L10.58 9.79L11.25 9.85L11.73 9.68L12.19 9.3L12.36 9.02L12.5 8.54L12.43 7.94L12.26 7.6L11.77 7.14L11.29 6.97L10.55 7.04L10.14 7.28L9.85 7.66L1.86 7.66L0.03 5.66L0.01 5.56Z" />
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
