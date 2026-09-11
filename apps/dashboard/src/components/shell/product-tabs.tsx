import Link from 'next/link';

/**
 * The in-page sub-navigation for one product family (RTC / Chat / Live
 * Streaming). The global sidebar only links to the family's landing
 * page (see lib/nav.ts): this is how a developer moves between Rooms,
 * Connections, and Participants without those cluttering the sidebar as
 * separate top-level entries.
 *
 * Plain server component (no usePathname): every caller already knows
 * which tab it is, so it just says so.
 */
export interface ProductTab {
  label: string;
  href: string;
}

export function ProductTabs({ tabs, active }: { tabs: ProductTab[]; active: string }) {
  return (
    <nav aria-label="Section" className="mb-6 flex items-center gap-1 border-b border-line">
      {tabs.map((tab) => {
        const isActive = tab.label === active;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={isActive ? 'page' : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
              isActive ? 'border-accent font-medium text-fg' : 'border-transparent text-muted hover:text-fg'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Spec §29's RTC section. `Servers` and `Diagnostics` sit at the end
 * on purpose: the first three answer "what are my users doing", the
 * last two answer "is the media plane itself healthy", and that is the
 * order you reach for them in.
 */
export function rtcTabs(base: string): ProductTab[] {
  return [
    { label: 'Rooms', href: `${base}/rooms` },
    { label: 'Connections', href: `${base}/connections` },
    { label: 'Participants', href: `${base}/participants` },
    { label: 'Servers', href: `${base}/servers` },
    { label: 'Diagnostics', href: `${base}/diagnostics` },
  ];
}

export function chatTabs(base: string): ProductTab[] {
  return [
    { label: 'Overview', href: `${base}/chat` },
    { label: 'Conversations', href: `${base}/chat/conversations` },
    { label: 'Connections', href: `${base}/chat/connections` },
  ];
}

export function liveStreamingTabs(base: string): ProductTab[] {
  return [
    { label: 'Overview', href: `${base}/live-streaming` },
    { label: 'Streams', href: `${base}/live-streaming/streams` },
  ];
}
