import { Reveal } from './Reveal';
import { DOCS_ROUTES } from '../lib/links';

const SDKS = [
  { name: 'Web', packages: ['@corvidhq/rtc', '@corvidhq/chat', '@corvidhq/client'], href: DOCS_ROUTES.sdkWeb },
  { name: 'React', packages: ['@corvidhq/react'], href: DOCS_ROUTES.sdkReact },
  { name: 'React Native', packages: ['@corvidhq/react-native'], href: DOCS_ROUTES.sdkReactNative },
  { name: 'Flutter', packages: ['raven_rtc', 'raven_chat', 'raven_live'], href: DOCS_ROUTES.sdkFlutter },
  { name: 'Node.js', packages: ['@corvidhq/server'], href: DOCS_ROUTES.sdkNode },
  { name: 'Python', packages: ['raven-sdk'], href: DOCS_ROUTES.sdkPython },
  { name: 'CLI', packages: ['@corvidhq/cli'], href: DOCS_ROUTES.cli },
];

export function SDKSection() {
  return (
    <section id="sdks" className="border-t border-line py-24">
      <div className="mx-auto max-w-6xl px-6">
        <Reveal>
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight text-fg md:text-4xl">
              Build in the language your team already uses.
            </h2>
            <p className="mt-4 text-muted">
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
                className="flex h-full flex-col rounded-xl border border-line bg-surface p-5 transition-shadow hover:shadow-raven-md"
              >
                <span className="font-semibold text-fg">{sdk.name}</span>
                <ul className="mt-3 flex flex-col gap-1">
                  {sdk.packages.map((pkg) => (
                    <li key={pkg} className="truncate font-mono text-xs text-muted">
                      {pkg}
                    </li>
                  ))}
                </ul>
                <span className="mt-auto pt-4 text-xs font-medium text-accent-text">Documentation →</span>
              </a>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
