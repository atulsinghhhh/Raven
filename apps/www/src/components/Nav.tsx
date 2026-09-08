'use client';

import Link from 'next/link';
import { DASHBOARD_URL, DISCORD_URL, DOCS_ROUTES, DOCS_URL } from '../lib/links';
import { DiscordIcon } from './icons';

const PRODUCT_LINKS = [
  { label: 'RTC', href: DOCS_ROUTES.rtc },
  { label: 'Chat', href: DOCS_ROUTES.chat },
  { label: 'Live Streaming', href: DOCS_ROUTES.liveStreaming },
  { label: 'Effects', href: DOCS_ROUTES.effects },
];

const DEVELOPER_LINKS = [
  { label: 'Documentation', href: DOCS_URL },
  { label: 'SDKs', href: DOCS_ROUTES.sdkWeb },
  { label: 'API Reference', href: DOCS_ROUTES.apiReference },
  { label: 'CLI', href: DOCS_ROUTES.cli },
  { label: 'Examples', href: DOCS_ROUTES.examples },
];

/**
 * Nav links read as ordinary sentence-case sans, not the mono-uppercase
 * console labels used elsewhere on the page: the reference layout
 * reserves mono for section eyebrows and code chrome, and the nav is
 * quieter for it. Everything actionable on the right is the same 4px
 * rectangle, filled for the primary action and hairline for the rest.
 */
export function Nav() {
  return (
    <header className="sticky top-0 z-50 border-b border-line bg-canvas/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-8 px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2 text-[15px] font-medium tracking-tight text-fg">
          <RavenMark />
          RAVEN
        </Link>

        <nav className="hidden items-center gap-1 text-[14px] text-muted md:flex">
          <NavMenu label="Products" links={PRODUCT_LINKS} />
          <NavMenu label="Developers" links={DEVELOPER_LINKS} />
          <Link href="/#reliability" className="rounded-(--radius-panel) px-3 py-1.5 transition-colors hover:text-fg">
            Reliability
          </Link>
          <a href={DOCS_URL} className="rounded-(--radius-panel) px-3 py-1.5 transition-colors hover:text-fg">
            Docs
          </a>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {/* Stands in for the reference's repo-star pill. Raven is
              closed-source, so the community signal is Discord, and it
              carries no member count we'd have to keep truthful. */}
          <a
            href={DISCORD_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="hidden items-center gap-2 rounded-(--radius-panel) px-2.5 py-1.5 text-[13px] text-muted transition-colors hover:text-fg lg:inline-flex"
          >
            <DiscordIcon className="h-4 w-4" />
            discord
            <span className="mono-label rounded-sm border border-line bg-surface px-1.5 py-0.5 text-[10px] text-muted">
              community
            </span>
          </a>
          <a
            href={DASHBOARD_URL}
            className="hidden rounded-(--radius-panel) border border-line px-3 py-1.5 text-[13px] font-medium text-fg transition-colors hover:border-line-strong hover:bg-surface sm:inline-block"
          >
            Sign in
          </a>
          <a
            href={`${DASHBOARD_URL}/signup`}
            className="glow-accent hidden rounded-(--radius-panel) bg-accent px-3 py-1.5 text-[13px] font-semibold text-accent-fg transition-colors hover:bg-accent-hover sm:inline-block"
          >
            Start building
          </a>
          <MobileNav />
        </div>
      </div>
    </header>
  );
}

function NavMenu({ label, links }: { label: string; links: { label: string; href: string }[] }) {
  return (
    <details className="group relative">
      <summary className="flex list-none items-center gap-1.5 rounded-(--radius-panel) px-3 py-1.5 transition-colors hover:text-fg [&::-webkit-details-marker]:hidden">
        {label}
        <ChevronDown className="transition-transform group-open:rotate-180" />
      </summary>
      <div className="absolute left-0 top-full z-10 mt-2 min-w-52 rounded-(--radius-panel) border border-line bg-surface p-1.5">
        {links.map((link) => (
          <a
            key={link.label}
            href={link.href}
            className="block rounded-(--radius-panel) px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-raised hover:text-fg"
          >
            {link.label}
          </a>
        ))}
      </div>
    </details>
  );
}

function MobileNav() {
  return (
    <details className="group relative md:hidden">
      <summary className="flex list-none items-center justify-center rounded-(--radius-panel) p-2 text-fg [&::-webkit-details-marker]:hidden">
        <span className="sr-only">Menu</span>
        <HamburgerIcon />
      </summary>
      <div className="absolute right-0 top-full z-10 mt-2 w-64 rounded-(--radius-panel) border border-line bg-surface p-2">
        <MobileSection title="Products" links={PRODUCT_LINKS} />
        <MobileSection title="Developers" links={DEVELOPER_LINKS} />
        <Link
          href="/#reliability"
          className="block rounded-(--radius-panel) px-3 py-2 text-sm text-muted hover:bg-surface-raised hover:text-fg"
        >
          Reliability
        </Link>
        <div className="mt-2 flex flex-col gap-2 border-t border-line pt-2">
          <a
            href={DASHBOARD_URL}
            className="rounded-(--radius-panel) border border-line px-3 py-2 text-center text-sm font-medium text-fg hover:bg-surface-raised"
          >
            Sign in
          </a>
          <a
            href={`${DASHBOARD_URL}/signup`}
            className="rounded-(--radius-panel) bg-accent px-3 py-2 text-center text-sm font-semibold text-accent-fg hover:bg-accent-hover"
          >
            Start building
          </a>
        </div>
      </div>
    </details>
  );
}

function MobileSection({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return (
    <div className="pb-1">
      <span className="mono-label block px-3 pt-1.5 text-[11px] text-muted">{title}</span>
      {links.map((link) => (
        <a
          key={link.label}
          href={link.href}
          className="block rounded-(--radius-panel) px-3 py-2 text-sm text-muted hover:bg-surface-raised hover:text-fg"
        >
          {link.label}
        </a>
      ))}
    </div>
  );
}

function RavenMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 text-accent" fill="currentColor" aria-hidden="true">
      <path d="M12 2 3 20h5.2l1.4-3.2h4.8L15.8 20H21L12 2Zm-1.3 11 1.3-3 1.3 3h-2.6Z" />
    </svg>
  );
}

function ChevronDown({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 12 12"
      className={`h-3 w-3 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d="M2.5 4.5 6 8l3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function HamburgerIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M3 5.5h14M3 10h14M3 14.5h14" strokeLinecap="round" />
    </svg>
  );
}
