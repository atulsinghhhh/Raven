import { Reveal } from './Reveal';
import { DOCS_ROUTES } from '../lib/links';

/**
 * Formerly Features.tsx's catch-all grid: narrowed to reliability
 * claims specifically, now that ProductOverview/RTCSection/ChatSection/
 * LiveStreamingSection/SDKSection carry the product-feature copy this
 * used to hold. Every claim here links to the doc that backs it; no
 * uptime/scale numbers Livqeno hasn't measured: see the "no fake
 * enterprise claims" note this page was built against.
 */
const RELIABILITY = [
  {
    title: 'Automatic reconnection',
    body: 'Reconnects with backoff instead of dropping the call on a network blip — the client rejoins the same room, not a new one.',
    href: DOCS_ROUTES.rtcReconnection,
  },
  {
    title: 'Token-based authentication',
    body: 'Your API key never leaves your backend. Clients only ever hold short-lived, scoped tokens — one room or conversation, one identity.',
    href: DOCS_ROUTES.rtcAuthentication,
  },
  {
    title: 'Environments & roles',
    body: 'Development, staging, and production are isolated all the way down — credentials, rooms, and webhooks never cross the boundary.',
    href: DOCS_ROUTES.environments,
  },
  {
    title: 'Webhooks',
    body: 'Server-side events for room, message, and stream lifecycle — so your backend hears about a disconnect without polling for it.',
    href: DOCS_ROUTES.webhooks,
  },
  {
    title: 'Real connection diagnostics',
    body: 'RTT, jitter, packet loss, bitrate, and codec, collected from live WebRTC stats — not a status dot.',
    href: DOCS_ROUTES.rtcDiagnostics,
  },
  {
    title: 'Audit logs',
    body: 'Every project-level change — API keys, roles, environments — recorded with who did what, and when.',
    href: DOCS_ROUTES.auditLogs,
  },
];

export function Reliability() {
  return (
    <section id="reliability" className="border-t border-line py-24 md:py-32">
      <div className="mx-auto max-w-6xl px-6">
        <Reveal>
          <div>
            <span className="mono-label text-[11px] text-muted">Reliability</span>
            <h2 className="display mt-4 text-3xl text-fg md:text-4xl">
              Guarantees, not <span className="kw">status dots</span>
            </h2>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-muted">
              Not a wrapper around someone else&apos;s API. Livqeno owns the control plane — projects, tokens,
              permissions, and events — end to end.
            </p>
          </div>
        </Reveal>

        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {RELIABILITY.map((item, i) => (
            <Reveal key={item.title} delayMs={i * 60}>
              <a
                href={item.href}
                className="block h-full rounded-(--radius-panel) border border-line bg-surface p-6 transition-colors hover:border-line-strong"
              >
                <h3 className="font-medium text-fg">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{item.body}</p>
              </a>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
