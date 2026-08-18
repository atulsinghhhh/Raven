import { Reveal } from './Reveal';

const FEATURES = [
  {
    title: 'Audio & video calling',
    body: 'Rooms, participants, screen share, and device switching, on top of WebRTC via LiveKit. Reconnects with backoff instead of dropping the call on a network blip.',
  },
  {
    title: 'Chat, built in',
    body: 'Conversations, threads, reactions, typing, presence, and read receipts — with idempotent sends and cursor-based pagination, not a bolted-on afterthought.',
  },
  {
    title: 'Real connection diagnostics',
    body: 'RTT, jitter, packet loss, bitrate, and codec, collected from live WebRTC stats — not a status dot. See exactly what a call looked like, after the fact.',
  },
  {
    title: 'Environments & roles',
    body: 'Development, staging, and production are isolated all the way down — credentials, rooms, and webhooks never cross the boundary. Five project roles, not one flat "member".',
  },
  {
    title: 'An SDK where you build',
    body: 'TypeScript, React, React Native, Flutter, and Python, all speaking the same wire protocol — plus a server SDK and CLI for everything you’d otherwise script by hand.',
  },
  {
    title: 'Self-hosted, honestly',
    body: 'Docker Compose brings up Postgres, Redis, LiveKit, and coturn locally. The same control plane runs in your infrastructure — nothing calls home.',
  },
];

export function Features() {
  return (
    <section id="features" className="border-t border-line bg-surface-sunken/40 py-24">
      <div className="mx-auto max-w-6xl px-6">
        <Reveal>
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight text-fg md:text-4xl">
              Everything a real-time product needs
            </h2>
            <p className="mt-4 text-muted">
              Not a wrapper around someone else&apos;s API. Raven owns the
              control plane — projects, tokens, permissions, and events —
              end to end.
            </p>
          </div>
        </Reveal>

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature, i) => (
            <Reveal key={feature.title} delayMs={i * 60}>
              <div className="h-full rounded-xl border border-line bg-surface p-6 shadow-raven-sm transition-shadow hover:shadow-raven-md">
                <h3 className="font-semibold text-fg">{feature.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{feature.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
