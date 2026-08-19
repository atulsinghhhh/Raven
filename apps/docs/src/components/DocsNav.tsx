'use client';

import Link from 'next/link';
import { useState } from 'react';
import { NAV } from '../lib/nav';
import { Search } from './Search';

const WWW_URL = process.env.NEXT_PUBLIC_WWW_URL ?? 'http://localhost:3100';
const DASHBOARD_URL = process.env.NEXT_PUBLIC_DASHBOARD_URL ?? 'http://localhost:3000';
const GITHUB_URL = 'https://github.com/atulsinghhhh/Raven';
const DISCORD_URL = 'https://discord.com/invite/HSWd9qMC7';

/**
 * The top bar: search, the mobile sidebar drawer, and the external
 * links. The only client-side piece of an otherwise fully static,
 * server-rendered site — every doc page is completely readable with
 * JavaScript disabled, search simply won't be available.
 */
export function DocsNav({ activeSlug }: { activeSlug?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-canvas/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 md:px-6">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle navigation"
          aria-expanded={open}
          className="rounded-md p-1.5 text-muted hover:bg-surface-raised md:hidden"
        >
          <MenuIcon />
        </button>

        <Link href={WWW_URL} className="flex items-center gap-2 font-semibold tracking-tight text-fg">
          <RavenMark />
          Raven Docs
        </Link>

        <div className="ml-auto flex items-center gap-4 text-sm">
          <Search />
          <a href={DASHBOARD_URL} className="hidden text-muted transition-colors hover:text-fg sm:inline">
            Dashboard
          </a>
          <a href={DISCORD_URL} target="_blank" rel="noreferrer noopener" aria-label="Discord" className="text-muted hover:text-fg">
            <DiscordIcon />
          </a>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer noopener" aria-label="GitHub" className="text-muted hover:text-fg">
            <GitHubIcon />
          </a>
        </div>
      </div>

      {open && (
        <div className="border-t border-line bg-canvas px-4 py-4 md:hidden">
          <nav>
            {NAV.map((section) => (
              <div key={section.title} className="mb-5">
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-subtle">
                  {section.title}
                </h3>
                <ul>
                  {section.items.map((item) => (
                    <li key={item.slug}>
                      <Link
                        href={`/${item.slug}`}
                        onClick={() => setOpen(false)}
                        className={`block rounded-md px-2 py-1.5 text-sm ${
                          item.slug === activeSlug ? 'bg-accent-subtle font-medium text-accent-text' : 'text-muted'
                        }`}
                      >
                        {item.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function RavenMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6 text-accent" fill="currentColor" aria-hidden="true">
      <path d="M12 2 3 20h5.2l1.4-3.2h4.8L15.8 20H21L12 2Zm-1.3 11 1.3-3 1.3 3h-2.6Z" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5" aria-hidden="true">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.1 3.29 9.42 7.86 10.95.58.1.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.04-.72.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.43-2.7 5.4-5.27 5.68.42.36.78 1.07.78 2.15 0 1.55-.01 2.8-.01 3.18 0 .31.21.67.8.56A10.52 10.52 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

function DiscordIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5" aria-hidden="true">
      <path d="M20.32 4.37a19.8 19.8 0 0 0-4.89-1.52.07.07 0 0 0-.08.04c-.21.38-.45.87-.61 1.26a18.3 18.3 0 0 0-5.48 0 12.6 12.6 0 0 0-.62-1.26.08.08 0 0 0-.08-.04c-1.7.29-3.36.8-4.89 1.52a.07.07 0 0 0-.03.03C.98 8.6.28 12.7.62 16.75a.08.08 0 0 0 .03.06 19.9 19.9 0 0 0 5.99 3.03.08.08 0 0 0 .08-.03c.46-.63.87-1.3 1.23-2a.08.08 0 0 0-.04-.11 13.1 13.1 0 0 1-1.87-.89.08.08 0 0 1 0-.13c.13-.09.25-.19.37-.28a.07.07 0 0 1 .08 0c3.93 1.8 8.18 1.8 12.06 0a.07.07 0 0 1 .08 0c.12.1.24.19.37.28a.08.08 0 0 1 0 .13c-.6.35-1.22.65-1.87.89a.08.08 0 0 0-.04.11c.36.7.78 1.37 1.23 2a.08.08 0 0 0 .08.03 19.85 19.85 0 0 0 6-3.03.08.08 0 0 0 .03-.06c.4-4.7-.67-8.76-2.83-12.35a.06.06 0 0 0-.03-.03ZM8.02 14.34c-1.18 0-2.15-1.08-2.15-2.4 0-1.33.95-2.41 2.15-2.41 1.21 0 2.17 1.09 2.15 2.41 0 1.32-.95 2.4-2.15 2.4Zm7.97 0c-1.18 0-2.15-1.08-2.15-2.4 0-1.33.96-2.41 2.15-2.41 1.21 0 2.17 1.09 2.15 2.41 0 1.32-.94 2.4-2.15 2.4Z" />
    </svg>
  );
}
