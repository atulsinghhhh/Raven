import { Reveal } from './Reveal';
import { DOCS_ROUTES } from '../lib/links';

const SDKS = [
  { name: 'Web', packages: ['@ravenkash/rtc', '@ravenkash/chat', '@ravenkash/client', '@ravenkash/effects'], href: DOCS_ROUTES.sdkWeb },
  { name: 'React', packages: ['@ravenkash/react', '@ravenkash/effects'], href: DOCS_ROUTES.sdkReact },
  { name: 'React Native', packages: ['@ravenkash/react-native', '@ravenkash/effects'], href: DOCS_ROUTES.sdkReactNative },
  { name: 'Flutter', packages: ['raven_rtc', 'raven_chat', 'raven_live'], href: DOCS_ROUTES.sdkFlutter },
  { name: 'Node.js', packages: ['@ravenkash/server'], href: DOCS_ROUTES.sdkNode },
  { name: 'Python', packages: ['raven-sdk'], href: DOCS_ROUTES.sdkPython },
  { name: 'CLI', packages: ['@ravenkash/cli'], href: DOCS_ROUTES.cli },
];

export function SDKSection() {
  return (
    <section id="sdks" className="border-t border-line bg-surface-sunken/40 py-24 md:py-32">
      <div className="mx-auto max-w-6xl px-6">
        <Reveal>
          <div>
            <span className="mono-label text-[11px] text-muted">SDKs</span>
            <h2 className="display mt-4 text-3xl text-fg md:text-4xl">
              Build in the <span className="kw">language</span> your team already uses
            </h2>
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted">
              One wire protocol, six SDKs speaking it. Not yet published to a package registry — install from a
              local checkout while Raven is in this phase; see{' '}
              <a href={DOCS_ROUTES.installingFromSource} className="text-accent-text hover:underline">
                Installing from source
              </a>
              .
            </p>
          </div>
        </Reveal>

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SDKS.map((sdk, i) => (
            <Reveal key={sdk.name} delayMs={i * 50}>
              <a
                href={sdk.href}
                className="flex h-full flex-col rounded-(--radius-panel) border border-line bg-surface p-5 transition-colors hover:border-line-strong"
              >
                <span className="text-sm font-medium text-fg">{sdk.name}</span>
                <ul className="mt-3 flex flex-col gap-1">
                  {sdk.packages.map((pkg) => (
                    <li key={pkg} className="truncate font-mono text-xs text-muted">
                      {pkg}
                    </li>
                  ))}
                </ul>
                <span className="mono-label mt-auto pt-4 text-[11px] text-accent-text">Documentation →</span>
              </a>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
