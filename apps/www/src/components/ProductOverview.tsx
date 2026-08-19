import { Reveal } from './Reveal';
import { DOCS_ROUTES } from '../lib/links';

const PRODUCTS = [
  {
    name: 'RTC',
    tagline: 'Audio and video communication without managing the real-time infrastructure.',
    bullets: ['Audio & video calls', 'Rooms & participants', 'Screen sharing', 'Reconnection & diagnostics'],
    href: DOCS_ROUTES.rtc,
  },
  {
    name: 'Chat',
    tagline: 'Real-time messaging built for applications, not bolted on afterward.',
    bullets: ['Conversations & threads', 'Presence & typing', 'Reactions', 'Delivery & read receipts'],
    href: DOCS_ROUTES.chat,
  },
  {
    name: 'Live Streaming',
    tagline: 'Build interactive live experiences on the same rooms and tokens underneath.',
    bullets: ['Hosts & co-hosts', 'Viewers', 'Live chat & reactions', 'Moderation'],
    href: DOCS_ROUTES.liveStreaming,
  },
  {
    name: 'Effects',
    tagline: 'Filters and presets on the video track itself, before it ever leaves the device.',
    bullets: ['Filters & presets', 'Beauty smoothing', 'Runs client-side, in the SDK', 'RTC & Live Streaming'],
    href: DOCS_ROUTES.effects,
  },
];

export function ProductOverview() {
  return (
    <section className="border-t border-line py-24">
      <div className="mx-auto max-w-6xl px-6">
        <Reveal>
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-light tracking-tight text-fg md:text-4xl">Everything you need for real-time</h2>
            <p className="mt-4 text-muted">
              One control plane underneath four products — the same projects, tokens, and events, whether
              you&apos;re shipping a call, a conversation, a stream, or a filtered camera feed.
            </p>
          </div>
        </Reveal>

        <div className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {PRODUCTS.map((product, i) => (
            <Reveal key={product.name} delayMs={i * 80}>
              <a
                href={product.href}
                className="group flex h-full flex-col rounded-(--radius-panel) border border-line bg-surface p-6 transition-colors hover:border-line-strong"
              >
                <h3 className="mono-label text-[12px] text-accent-text">{product.name}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted">{product.tagline}</p>
                <ul className="mt-4 flex-1 space-y-1.5 text-sm text-muted">
                  {product.bullets.map((bullet) => (
                    <li key={bullet} className="flex items-center gap-2">
                      <span className="h-1 w-1 shrink-0 rounded-full bg-accent" />
                      {bullet}
                    </li>
                  ))}
                </ul>
                <span className="mono-label mt-5 inline-flex items-center gap-1 text-[11px] text-fg">
                  Explore
                  <span className="transition-transform group-hover:translate-x-0.5">→</span>
                </span>
              </a>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
