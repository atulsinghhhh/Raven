import { DOCS_ROUTES } from '../lib/links';

/**
 * The four-up card grid that sits directly under the code panel — no
 * heading of its own, since CodeShowcase already carries one for the
 * whole block. Cards are hairline rectangles with an icon, a line of
 * copy, and a small button, in the reference's proportions.
 */
const PRODUCTS = [
  {
    name: 'RTC',
    body: 'Audio and video calls with rooms, participants, and screen sharing — reconnection handled underneath.',
    href: DOCS_ROUTES.rtc,
    icon: <WaveIcon />,
  },
  {
    name: 'Chat',
    body: 'Conversations, threads, presence, typing, and receipts, built for applications rather than bolted on.',
    href: DOCS_ROUTES.chat,
    icon: <BubbleIcon />,
  },
  {
    name: 'Live Streaming',
    body: 'Hosts, co-hosts, and viewers on the same rooms and tokens, with live chat attached on join.',
    href: DOCS_ROUTES.liveStreaming,
    icon: <BroadcastIcon />,
  },
  {
    name: 'Effects',
    body: 'Filters and presets applied to the video track inside the SDK, before it ever leaves the device.',
    href: DOCS_ROUTES.effects,
    icon: <SparkIcon />,
  },
];

export function ProductOverview() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {PRODUCTS.map((product) => (
        <div
          key={product.name}
          className="flex h-full flex-col rounded-(--radius-panel) border border-line bg-surface p-5"
        >
          <span className="text-accent">{product.icon}</span>
          <h3 className="mt-4 text-sm font-medium text-fg">{product.name}</h3>
          <p className="mt-2 flex-1 text-[13px] leading-relaxed text-muted">{product.body}</p>
          <a
            href={product.href}
            className="mt-5 self-start rounded-(--radius-panel) border border-line bg-surface-raised px-2.5 py-1.5 text-[12px] font-medium text-fg transition-colors hover:border-line-strong"
          >
            Try it out
          </a>
        </div>
      ))}
    </div>
  );
}

function WaveIcon() {
  return (
    <svg viewBox="0 0 18 18" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M2 9h1.7M6.2 5v8M9 2.5v13M11.8 6v6M15.5 9H16" strokeLinecap="round" />
    </svg>
  );
}

function BubbleIcon() {
  return (
    <svg viewBox="0 0 18 18" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M2.5 5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H8l-4 3.2V12a1.5 1.5 0 0 1-1.5-1.5V5Z" strokeLinejoin="round" />
    </svg>
  );
}

function BroadcastIcon() {
  return (
    <svg viewBox="0 0 18 18" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <circle cx="9" cy="9" r="2" />
      <path d="M5.2 5.2a5.4 5.4 0 0 0 0 7.6M12.8 12.8a5.4 5.4 0 0 0 0-7.6M2.6 2.6a9 9 0 0 0 0 12.8M15.4 15.4a9 9 0 0 0 0-12.8" strokeLinecap="round" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg viewBox="0 0 18 18" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M9 2v3.4M9 12.6V16M2 9h3.4M12.6 9H16M4.4 4.4l2.4 2.4M11.2 11.2l2.4 2.4M13.6 4.4l-2.4 2.4M6.8 11.2l-2.4 2.4" strokeLinecap="round" />
    </svg>
  );
}
