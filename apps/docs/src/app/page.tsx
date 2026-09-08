import Link from 'next/link';
import { DocsNav } from '../components/DocsNav';
import { Sidebar } from '../components/Sidebar';
import { NAV, type NavSection } from '../lib/nav';

/**
 * The home page used to enumerate all 79 pages as fifteen lists of
 * links, which meant the two things a new reader actually needs: the
 * quickstart, and a sense of what Raven contains: were buried in a
 * wall of equally-weighted text.
 *
 * It now reads top to bottom as a path: start here, then the four
 * products, then everything else in one compact index. Nothing is
 * unreachable that was reachable before: the full tree is in the
 * sidebar on every page, including this one.
 *
 * Section titles, page counts and first-page links are all derived from
 * NAV rather than written out here, so adding a page can't leave this
 * page claiming the wrong number.
 */
function section(title: string): NavSection {
  const found = NAV.find((s) => s.title === title);
  if (!found) {
    // NAV is a static module and layout.tsx already asserts every slug
    // in it resolves to a real file, so a miss here means this page
    // names a section that no longer exists: a build-time typo, worth
    // failing loudly instead of rendering a hole.
    throw new Error(`Docs home references a section that is not in NAV: ${title}`);
  }
  return found;
}

const PRODUCTS = [
  { title: 'RTC', blurb: 'Audio and video calls — rooms, participants, screen sharing, and reconnection.' },
  { title: 'Chat', blurb: 'Conversations, threads, presence, typing, and delivery receipts.' },
  { title: 'Live Streaming', blurb: 'Hosts, co-hosts, and viewers, with live chat attached on join.' },
  { title: 'Effects', blurb: 'Filters and presets applied to the camera track inside the SDK.' },
];

const PRODUCT_TITLES = new Set(PRODUCTS.map((p) => p.title));

export default function DocsHome() {
  const start = section('Getting Started');
  const rest = NAV.filter((s) => !PRODUCT_TITLES.has(s.title) && s.title !== start.title);

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
            <h1 className="display mt-4 text-4xl text-fg">Build real-time on Raven</h1>
            <p className="mt-5 text-base leading-relaxed text-muted">
              Guides and reference for audio, video, chat, live streaming, and camera effects. If you&apos;re
              new, start with the quickstart — every other page assumes you already have a project and a token.
            </p>
            <div className="mt-7 flex flex-wrap gap-2.5">
              <Link
                href="/getting-started/quickstart"
                className="rounded-md bg-accent px-4 py-2 text-[13px] font-semibold text-accent-fg transition-colors hover:bg-accent-hover"
              >
                Quickstart
              </Link>
              <Link
                href="/getting-started/architecture"
                className="rounded-md border border-line px-4 py-2 text-[13px] font-medium text-fg transition-colors hover:border-line-strong hover:bg-surface"
              >
                How Raven fits together
              </Link>
            </div>
          </header>

          <Band title="Start here">
            <div className="grid gap-3 sm:grid-cols-2">
              {start.items.map((item, i) => (
                <Link
                  key={item.slug}
                  href={`/${item.slug}`}
                  className="group flex items-baseline gap-3 rounded-md border border-line bg-surface p-4 transition-colors hover:border-line-strong hover:bg-surface-raised"
                >
                  <span className="mono-label text-[11px] text-muted">{String(i + 1).padStart(2, '0')}</span>
                  <span className="min-w-0 flex-1 text-sm font-medium text-fg">{item.title}</span>
                  <Arrow />
                </Link>
              ))}
            </div>
          </Band>

          <Band title="Products">
            <div className="grid gap-3 sm:grid-cols-2">
              {PRODUCTS.map((product) => {
                const nav = section(product.title);
                return (
                  <div
                    key={product.title}
                    className="flex flex-col rounded-md border border-line bg-surface p-5"
                  >
                    <h3 className="text-sm font-medium text-fg">{product.title}</h3>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{product.blurb}</p>

                    <ul className="mt-4 flex flex-1 flex-col gap-1.5">
                      {nav.items.slice(0, 4).map((item) => (
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
