import { DOCS_ROUTES, DOCS_URL } from '../lib/links';
import { RavenMark } from './icons';

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
];

export function Footer() {
  return (
    <footer className="border-t border-line py-16">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <span className="flex items-center gap-2 text-[15px] font-medium tracking-tight text-fg">
              <RavenMark className="h-5 w-5" />
              LIVQENO
            </span>
            <p className="mt-3 max-w-xs text-sm text-muted">
              Real-time infrastructure for developers — RTC, chat, live streaming, and effects through one API.
            </p>
          </div>

          {COLUMNS.map((column) => (
            <div key={column.title}>
              <span className="mono-label text-[11px] text-muted">{column.title}</span>
              <ul className="mt-3 flex flex-col gap-2.5">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      target={link.href.startsWith('http') ? '_blank' : undefined}
                      rel={link.href.startsWith('http') ? 'noreferrer noopener' : undefined}
                      className="flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-fg"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 border-t border-line pt-6 text-sm text-muted">
          <p>&copy; Livqeno. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
