import { DASHBOARD_URL, DISCORD_URL, DOCS_ROUTES, DOCS_URL } from '../lib/links';
import { DiscordIcon } from './icons';

const COLUMNS = [
  {
    title: 'Product',
    links: [
      { label: 'RTC', href: DOCS_ROUTES.rtc },
      { label: 'Chat', href: DOCS_ROUTES.chat },
      { label: 'Live Streaming', href: DOCS_ROUTES.liveStreaming },
      { label: 'Effects', href: DOCS_ROUTES.effects },
    ],
  },
  {
    title: 'Developers',
    links: [
      { label: 'Documentation', href: DOCS_URL },
      { label: 'SDKs', href: DOCS_ROUTES.sdkWeb },
      { label: 'API Reference', href: DOCS_ROUTES.apiReference },
      { label: 'CLI', href: DOCS_ROUTES.cli },
      { label: 'Examples', href: DOCS_ROUTES.examples },
    ],
  },
  {
    title: 'Community',
    links: [
      { label: 'Discord', href: DISCORD_URL },
      { label: 'Dashboard', href: DASHBOARD_URL },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-line py-16">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <span className="flex items-center gap-2 text-[15px] font-medium tracking-tight text-fg">
              <RavenMark />
              RAVEN
            </span>
            <p className="mt-3 max-w-xs text-sm text-muted">
              Real-time infrastructure for developers — RTC, chat, live streaming, and effects through one API.
            </p>
          </div>

          {COLUMNS.map((column) => (
            <div key={column.title}>
              <span className="mono-label text-[11px] text-subtle">{column.title}</span>
              <ul className="mt-3 flex flex-col gap-2.5">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      target={link.href.startsWith('http') && link.href !== DASHBOARD_URL ? '_blank' : undefined}
                      rel={link.href.startsWith('http') && link.href !== DASHBOARD_URL ? 'noreferrer noopener' : undefined}
                      className="flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-fg"
                    >
                      {link.label === 'Discord' && <DiscordIcon className="h-4 w-4" />}
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <p className="mt-12 border-t border-line pt-6 text-sm text-subtle">&copy; Raven. All rights reserved.</p>
      </div>
    </footer>
  );
}

function RavenMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 text-accent" fill="currentColor" aria-hidden="true">
      <path d="M12 2 3 20h5.2l1.4-3.2h4.8L15.8 20H21L12 2Zm-1.3 11 1.3-3 1.3 3h-2.6Z" />
    </svg>
  );
}
