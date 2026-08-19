import Link from 'next/link';
import { DASHBOARD_URL, DISCORD_URL, DOCS_URL } from '../lib/links';
import { DiscordIcon } from './icons';

export function Nav() {
  return (
    <header className="sticky top-0 z-50 border-b border-line bg-canvas/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight text-fg">
          <RavenMark />
          Raven
        </Link>

        <nav className="hidden items-center gap-8 text-sm text-muted md:flex">
          <a href={DOCS_URL} className="transition-colors hover:text-fg">
            Docs
          </a>
          <Link href="/#features" className="transition-colors hover:text-fg">
            Features
          </Link>
          <Link href="/#how-it-works" className="transition-colors hover:text-fg">
            How it works
          </Link>
        </nav>

        {/* Discord (community support) top right, plus sign-in/sign-up CTAs. */}
        <div className="flex items-center gap-4">
          <a
            href={DISCORD_URL}
            target="_blank"
            rel="noreferrer noopener"
            aria-label="Join the Raven Discord"
            className="text-muted transition-colors hover:text-fg"
          >
            <DiscordIcon />
          </a>
          <a href={DASHBOARD_URL} className="hidden text-sm font-medium text-muted transition-colors hover:text-fg sm:inline">
            Sign in
          </a>
          <a
            href={`${DASHBOARD_URL}/signup`}
            className="rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg shadow-raven-sm transition-colors hover:bg-accent-hover"
          >
            Get started
          </a>
        </div>
      </div>
    </header>
  );
}

function RavenMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6 text-accent" fill="currentColor" aria-hidden="true">
      <path d="M12 2 3 20h5.2l1.4-3.2h4.8L15.8 20H21L12 2Zm-1.3 11 1.3-3 1.3 3h-2.6Z" />
    </svg>
  );
}
