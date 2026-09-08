import Link from 'next/link';
import { DocsNav } from '../components/DocsNav';
import { Sidebar } from '../components/Sidebar';
import { NAV, PRODUCTS, type NavSection } from '../lib/nav';

/**
 * The home page reads top to bottom as a decision, not as an index: what
 * Raven is, the shortest thing you can run, then the five paths a reader
 * actually arrives wanting. The full tree stays in the sidebar on every page,
 * this one included, so nothing here is the only route to anything.
 *
 * Section titles, page counts and first-page links are derived from NAV rather
 * than written out, so adding a page cannot leave this page claiming the wrong
 * number.
 */
function section(title: string): NavSection {
  const found = NAV.find((s) => s.title === title);
  if (!found) {
    // NAV is a static module and layout.tsx already asserts every slug in it
    // resolves to a real file, so a miss here means this page names a section
    // that no longer exists — a build-time typo, worth failing loudly rather
    // than rendering a hole.
    throw new Error(`Docs home references a section that is not in NAV: ${title}`);
  }
  return found;
}

/** What Raven actually runs. Ordered by how often a reader wants each one. */
const CAPABILITIES = [
  { name: 'Audio & video', detail: 'Rooms, participants, tracks, devices' },
  { name: 'RTC', detail: 'Own SFU, signaling, TURN, reconnection' },
  { name: 'Chat', detail: 'Durable messages, threads, presence' },
  { name: 'Live streaming', detail: 'Hosts, viewers, attached live chat' },
  { name: 'Effects', detail: 'Camera filters and presets' },
  { name: 'Webhooks', detail: 'Signed, retried, environment-scoped' },
  { name: 'SDKs', detail: 'Web, React, React Native, Flutter, Node, Python' },
  { name: 'REST API', detail: '110 versioned endpoints, one per SDK call' },
];

/** The five things a reader arrives wanting to do. */
const PATHS = [
  {
    href: '/guides/build-a-video-call',
    title: 'Build a video call',
    blurb: 'Two participants, camera and microphone, from an empty folder.',
  },
  {
    href: '/guides/build-a-chat-application',
    title: 'Build a chat application',
    blurb: 'Conversations, durable history, presence, and typing.',
  },
  {
    href: '/guides/build-a-live-stream',
    title: 'Build a live stream',
    blurb: 'One host, many viewers, live chat attached on join.',
  },
  { href: '/sdk', title: 'Explore SDKs', blurb: 'Eight SDKs across six languages, and what each supports.' },
  { href: '/api', title: 'Explore the API', blurb: 'Every REST endpoint, generated from the controllers.' },
];

const PRODUCT_BLURBS: Record<string, string> = {
  rtc: 'Audio and video calls — rooms, participants, screen sharing, reconnection.',
  chat: 'Conversations, threads, presence, typing, and delivery receipts.',
  'live-streaming': 'Hosts, co-hosts, and viewers, with live chat attached on join.',
  effects: 'Filters and presets applied to the camera track inside the SDK.',
};

const PRODUCT_TITLES = new Set(PRODUCTS.map((p) => section(sectionTitleFor(p.id)).title));

function sectionTitleFor(id: string): string {
  const match = NAV.find((s) => s.product === id);
  if (!match) throw new Error(`No NAV section carries product id "${id}"`);
  return match.title;
}

export default function DocsHome() {
  const intro = section('Introduction');
  const rest = NAV.filter((s) => !PRODUCT_TITLES.has(s.title) && s.title !== intro.title);

  return (
    <>
      <DocsNav />
      <div className="mx-auto flex max-w-[88rem] gap-8 px-4 py-8 md:px-6 lg:gap-12">
        <aside className="hidden w-56 shrink-0 lg:block">
          <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pb-8">
            <Sidebar />
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="max-w-2xl">
            <span className="mono-label text-[11px] text-muted">Documentation</span>
            <h1 className="display mt-4 text-4xl text-fg">Infrastructure for real-time applications</h1>
            <p className="mt-5 text-base leading-relaxed text-muted">
              Raven runs the audio, video, chat, and live streaming layer of your product, so you do not operate WebRTC
              signaling, a media server, TURN, or a message store yourself. You keep the interface; Raven keeps the
              pipes.
            </p>
            <div className="mt-7 flex flex-wrap gap-2.5">
              <Link
                href="/getting-started/quickstart"
                className="rounded-md bg-accent px-4 py-2 text-[13px] font-semibold text-accent-fg transition-colors hover:bg-accent-hover"
              >
                Quickstart
              </Link>
              <Link
                href="/concepts"
                className="rounded-md border border-line px-4 py-2 text-[13px] font-medium text-fg transition-colors hover:border-line-strong hover:bg-surface"
              >
                Core concepts
              </Link>
            </div>
          </header>

          <Band title="Capabilities">
            <ul className="grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
              {CAPABILITIES.map((c) => (
                <li key={c.name} className="bg-surface px-4 py-3.5">
                  <span className="block text-[13px] font-medium text-fg">{c.name}</span>
                  <span className="mt-1 block text-xs leading-relaxed text-muted">{c.detail}</span>
                </li>
              ))}
            </ul>
          </Band>

          <Band title="The shortest thing that works">
            <div className="overflow-hidden rounded-md border border-line bg-surface">
              <div className="border-b border-line px-4 py-2.5">
                <span className="mono-label text-[11px] text-muted">Your backend — mint a token</span>
              </div>
              <pre className="overflow-x-auto px-4 py-3.5 text-[12.5px] leading-relaxed">
                <code>{`import { Raven } from '@corvidhq/server';

const raven = new Raven({ apiKey: process.env.RAVEN_API_KEY! });
const room = await raven.rooms.create({ name: 'demo' });

const credentials = await raven.tokens.create({
  room: room.id,
  identity: 'user-42',
  permissions: { join: true, publish: true, subscribe: true },
});`}</code>
              </pre>
              <div className="border-y border-line px-4 py-2.5">
                <span className="mono-label text-[11px] text-muted">Your frontend — join and publish</span>
              </div>
              <pre className="overflow-x-auto px-4 py-3.5 text-[12.5px] leading-relaxed">
                <code>{`import { createRTCClient } from '@corvidhq/rtc';

const client = createRTCClient(credentials);
const room = await client.join(credentials.roomId);

await room.enableCamera();
await room.enableMicrophone();`}</code>
              </pre>
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-muted">
              That is a working call.{' '}
              <Link href="/getting-started/quickstart" className="text-accent-text hover:underline">
                The quickstart
              </Link>{' '}
              walks the same path with the project setup, the install commands, and the participant events.
            </p>
          </Band>

          <Band title="Pick a path">
            <ul className="grid gap-3 sm:grid-cols-2">
              {PATHS.map((p) => (
                <li key={p.href}>
                  <Link
                    href={p.href}
                    className="group flex h-full flex-col rounded-md border border-line bg-surface p-4 transition-colors hover:border-line-strong hover:bg-surface-raised"
                  >
                    <span className="flex items-center gap-2 text-sm font-medium text-fg">
                      {p.title}
                      <Arrow />
                    </span>
                    <span className="mt-1.5 text-[13px] leading-relaxed text-muted">{p.blurb}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Band>

          <Band title="Products">
            <div className="grid gap-3 sm:grid-cols-2">
              {PRODUCTS.map((product) => {
                const nav = section(sectionTitleFor(product.id));
                return (
                  <div key={product.id} className="flex flex-col rounded-md border border-line bg-surface p-5">
                    <h3 className="text-sm font-medium text-fg">{product.label}</h3>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{PRODUCT_BLURBS[product.id]}</p>

                    <ul className="mt-4 flex flex-1 flex-col gap-1.5">
                      {nav.items.slice(1, 5).map((item) => (
                        <li key={item.slug}>
                          <Link
                            href={`/${item.slug}`}
                            className="text-[13px] text-muted transition-colors hover:text-accent-text"
                          >
                            {item.title}
                          </Link>
                        </li>
                      ))}
                    </ul>

                    <Link
                      href={`/${nav.items[0].slug}`}
                      className="mono-label mt-5 inline-flex items-center gap-1.5 text-[11px] text-accent-text hover:underline"
                    >
                      All {nav.items.length} pages
                      <span aria-hidden="true">&rarr;</span>
                    </Link>
                  </div>
                );
              })}
            </div>
          </Band>

          <Band title="Everything else">
            <ul className="grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-2">
              {rest.map((s) => (
                <li key={s.title}>
                  <Link
                    href={`/${s.items[0].slug}`}
                    className="group flex items-center gap-3 bg-surface px-4 py-3 transition-colors hover:bg-surface-raised"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-fg">{s.title}</span>
                    <span className="mono-label shrink-0 text-[11px] text-muted">
                      {s.items.length} {s.items.length === 1 ? 'page' : 'pages'}
                    </span>
                    <Arrow />
                  </Link>
                </li>
              ))}
            </ul>
          </Band>
        </main>
      </div>
    </>
  );
}

function Band({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-14">
      <h2 className="mono-label mb-4 text-[11px] text-muted">{title}</h2>
      {children}
    </section>
  );
}

function Arrow() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-3.5 shrink-0 text-muted transition-transform group-hover:translate-x-0.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d="M6 3.5 10.5 8 6 12.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
