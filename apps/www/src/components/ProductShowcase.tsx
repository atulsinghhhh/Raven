'use client';

import { useState } from 'react';
import { ChatDemo, EffectsDemo, LiveDemo, RoomDemo } from './ProductDemos';
import { DOCS_ROUTES } from '../lib/links';

/**
 * The product tab strip and the showcase card under it: one card at a
 * time, switched by the strip, replacing what used to be four
 * full-height alternating sections (RTC / Chat / Live Streaming /
 * Effects). Same copy and same visuals, a quarter of the scroll.
 *
 * Every bullet is a capability that exists today and has a doc page
 * behind it; nothing here is roadmap.
 */
const PRODUCTS = [
  {
    id: 'rtc',
    label: 'RTC',
    icon: <WaveIcon />,
    headline: 'Video calls without the infrastructure headache.',
    body: 'Rooms, participants, and reconnection are handled underneath. Your app calls join() and gets back a room with cameras, microphones, and screen shares already wired for network blips.',
    bullets: ['Rooms, participants, and screen sharing', 'Automatic reconnection with backoff', 'RTT, jitter, and packet loss from live WebRTC stats'],
    href: DOCS_ROUTES.rtc,
    demo: <RoomDemo />,
  },
  {
    id: 'chat',
    label: 'Chat',
    icon: <BubbleIcon />,
    headline: 'Messaging that feels instant.',
    body: 'Conversations, presence, typing, and receipts — with idempotent sends and cursor-based pagination underneath, so a retried request never double-posts a message.',
    bullets: ['Conversations, threads, and presence', 'Delivery and read receipts', 'Idempotent sends, cursor-based history'],
    href: DOCS_ROUTES.chat,
    demo: <ChatDemo />,
  },
  {
    id: 'live',
    label: 'Live Streaming',
    icon: <BroadcastIcon />,
    headline: 'Turn any product into a live experience.',
    body: 'A host publishes, viewers watch, co-hosts join in — with a Raven Chat conversation attached automatically for live comments and reactions. Same rooms and tokens as RTC, one join call.',
    bullets: ['Hosts, co-hosts, and viewers', 'Live chat attached on join', 'Reactions and moderation on one connection'],
    href: DOCS_ROUTES.liveStreaming,
    demo: <LiveDemo />,
  },
  {
    id: 'effects',
    label: 'Effects',
    icon: <SparkIcon />,
    headline: 'Filters on the track, before it leaves the device.',
    body: 'camera.attachEffects() swaps the published track in place — no reconnect, no renegotiation. It runs entirely inside the SDK, shared by RTC and Live Streaming.',
    bullets: ['Filters and five built-in presets', 'Swaps the published track in place', 'Runs client-side, no extra round trip'],
    href: DOCS_ROUTES.effects,
    demo: <EffectsDemo />,
  },
] as const;

export function ProductShowcase() {
  const [active, setActive] = useState<(typeof PRODUCTS)[number]['id']>('rtc');
  const product = PRODUCTS.find((p) => p.id === active)!;

  return (
    <section className="mx-auto max-w-6xl px-6 pb-28 md:pb-36">
      <div
        className="mono-label inline-flex max-w-full gap-1 overflow-x-auto rounded-(--radius-panel) border border-line bg-surface-raised p-1 text-[11px]"
        role="tablist"
        aria-label="Raven products"
      >
        {PRODUCTS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={p.id === active}
            onClick={() => setActive(p.id)}
            className={`inline-flex shrink-0 items-center gap-2 rounded-(--radius-panel) px-3 py-2 transition-colors ${
              p.id === active ? 'bg-accent-subtle text-accent-text' : 'text-muted hover:text-fg'
            }`}
          >
            {p.icon}
            {p.label}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-10 rounded-2xl bg-surface p-8 card-lift md:grid-cols-2 md:items-center md:gap-12 md:p-10">
        <div>
          <span className="mono-label inline-flex items-center gap-2 rounded-(--radius-panel) border border-accent-line bg-accent-subtle px-2.5 py-1 text-[10px] text-accent-text">
            {product.icon}
            {product.label}
          </span>

          <h2 className="display mt-6 text-2xl text-fg md:text-3xl">{product.headline}</h2>
          <p className="mt-4 text-sm leading-relaxed text-muted">{product.body}</p>

          <ul className="mt-6 flex flex-col gap-2.5">
            {product.bullets.map((bullet) => (
              <li key={bullet} className="flex items-start gap-2.5 text-sm text-muted">
                <CheckIcon />
                {bullet}
              </li>
            ))}
          </ul>

          <a
            href={product.href}
            className="mt-8 inline-block rounded-(--radius-panel) border border-accent-line px-3.5 py-2 text-[13px] font-medium text-fg transition-colors hover:border-accent-text"
          >
            {product.label} documentation
          </a>
        </div>

        {/* Keyed on the product so switching tabs remounts the demo and
            its entrance animation replays, rather than swapping content
            underneath a panel that has already finished animating. */}
        <div key={product.id}>{product.demo}</div>
      </div>
    </section>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
      <path d="M3 8.5 6.2 11.5 13 4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function WaveIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M2 8h1.5M5.5 4.5v7M8 2.5v11M10.5 5.5v5M13.5 8H14" strokeLinecap="round" />
    </svg>
  );
}

function BubbleIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M2.5 4.5A2 2 0 0 1 4.5 2.5h7a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H7l-3.5 3v-3a1 1 0 0 1-1-1v-5Z" strokeLinejoin="round" />
    </svg>
  );
}

function BroadcastIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="8" cy="8" r="1.75" />
      <path d="M4.6 4.6a4.8 4.8 0 0 0 0 6.8M11.4 11.4a4.8 4.8 0 0 0 0-6.8M2.3 2.3a8 8 0 0 0 0 11.4M13.7 13.7a8 8 0 0 0 0-11.4" strokeLinecap="round" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M8 2v3M8 11v3M2 8h3M11 8h3M4.2 4.2l2 2M9.8 9.8l2 2M11.8 4.2l-2 2M6.2 9.8l-2 2" strokeLinecap="round" />
    </svg>
  );
}
