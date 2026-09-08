import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { CodeBlock } from '@/components/ui/code-block';
import { ButtonLink } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { IconExternal } from '@/components/ui/icons';
import { DOCS_URL } from '@/lib/nav';

/**
 * Index of the SDKs that actually ship from this monorepo. Name, version
 * and description are transcribed from each package's own manifest
 * (each packages/… package.json, sdks/python/pyproject.toml) and the snippets
 * from its entry point: this page never advertises a package that
 * doesn't exist, and every docs link below points at a file that is
 * present in docs/.
 *
 * Versions are kept in sync by hand, the same convention the SDKs
 * themselves use for their own SDK_VERSION constants.
 */

type Surface = 'browser' | 'server' | 'react';

interface SdkEntry {
  name: string;
  version: string;
  surface: Surface;
  headline: string;
  description: string;
  install: { code: string; language: string };
  usage: { code: string; language: string };
  docsHref?: string;
  docsLabel?: string;
  /** Shown when there is no published reference page yet: stated plainly instead of linking nowhere. */
  docsNote?: string;
}

const SURFACE_LABEL: Record<Surface, string> = {
  browser: 'Browser',
  server: 'Server',
  react: 'React',
};

const SDKS: SdkEntry[] = [
  {
    name: '@corvidhq/rtc',
    version: '0.1.0',
    surface: 'browser',
    headline: 'Join rooms and publish media from the browser',
    description:
      'Raven browser SDK — join a room, publish camera/microphone, subscribe to remote media. Hides SDP/ICE/STUN/TURN/SFU behind a small typed API. It never holds an API key: it only ever receives a token your backend already minted.',
    install: { language: 'bash', code: 'npm install @corvidhq/rtc' },
    usage: {
      language: 'typescript',
      code: `import { createRTCClient } from '@corvidhq/rtc';

// token / endpoint / iceServers all come from your backend's mint response.
const client = createRTCClient({ token, endpoint, iceServers });

const room = await client.join(roomId);
await room.enableCamera();
await room.enableMicrophone();

room.on('trackSubscribed', (track) => {
  document.querySelector('#stage')?.appendChild(track.attach());
});`,
    },
    docsHref: `${DOCS_URL}/sdk.md`,
    docsLabel: 'docs/sdk.md',
  },
  {
    name: '@corvidhq/server',
    version: '0.1.0',
    surface: 'server',
    headline: 'Mint tokens and read project data from Node.js',
    description:
      'Raven server SDK — mint short-lived RTC tokens, manage rooms, and read connection/error diagnostics from your own backend. Requires Node.js 20 or newer, and ships both ESM and CommonJS builds with full types. Never for use in a browser.',
    install: { language: 'bash', code: 'npm install @corvidhq/server' },
    usage: {
      language: 'typescript',
      code: `import { Raven } from '@corvidhq/server';

const raven = new Raven({ apiKey: process.env.RAVEN_API_KEY! });

const room = await raven.rooms.create({ name: 'standup' });

const issued = await raven.tokens.create({
  room: room.id,
  identity: 'alice',
  permissions: { join: true, subscribe: true, publish: true },
});

// Also available: raven.projects, raven.connections, raven.errors,
// raven.metrics, raven.diagnostics.`,
    },
    docsHref: `${DOCS_URL}/sdk/server/typescript.md`,
    docsLabel: 'docs/sdk/server/typescript.md',
  },
  {
    name: 'raven-sdk',
    version: '0.1.0',
    surface: 'server',
    headline: 'The same server API, for Python backends',
    description:
      'Raven server SDK for Python — mint short-lived RTC tokens, manage rooms, and read connection/error diagnostics from your own backend. Requires Python 3.10 or newer, and ships both a synchronous Raven client and an async AsyncRaven. Never for use in a browser.',
    install: { language: 'bash', code: 'pip install raven-sdk' },
    usage: {
      language: 'python',
      code: `import os
from raven import Raven, CreateTokenParams, TokenPermissions

raven = Raven(api_key=os.environ["RAVEN_API_KEY"])

room = raven.rooms.create(name="standup")

issued = raven.tokens.create(
    CreateTokenParams(
        room=room["id"],
        identity="alice",
        permissions=TokenPermissions(join=True, subscribe=True, publish=True),
    )
)

# Also available: raven.projects, raven.connections, raven.errors,
# raven.metrics, raven.diagnostics — and AsyncRaven for asyncio.`,
    },
    docsHref: `${DOCS_URL}/sdk/server/python.md`,
    docsLabel: 'docs/sdk/server/python.md',
  },
  {
    name: '@corvidhq/react',
    version: '0.1.0',
    surface: 'react',
    headline: 'Hooks and optional UI primitives over @corvidhq/rtc',
    description:
      'React hooks and optional UI primitives for @corvidhq/rtc — headless by default, no UI lock-in. RavenRoom owns one connection for its lifetime and always leaves on unmount, so a call UI is torn down by unmounting a component. Client-only: never render it from a Server Component.',
    install: { language: 'bash', code: 'npm install @corvidhq/react @corvidhq/rtc' },
    usage: {
      language: 'typescript',
      code: `'use client';
import { RavenRoom, useParticipants, ParticipantView } from '@corvidhq/react';

function Stage() {
  const participants = useParticipants();
  return participants.map((p) => <ParticipantView key={p.identity} participant={p} />);
}

// token / endpoint / iceServers come from your backend, same as @corvidhq/rtc.
<RavenRoom room={roomId} token={token} endpoint={endpoint} iceServers={iceServers}>
  <Stage />
</RavenRoom>;`,
    },
    docsNote:
      'No published reference page yet — the exported hooks and components are listed in packages/react-sdk/src/index.ts, and the underlying behaviour is documented in docs/sdk.md.',
  },
];

export default async function SdksPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const token = await getSessionToken();
  if (!token) redirect('/login');

  const base = `/dashboard/projects/${projectId}`;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="SDKs"
        description="Official Raven client libraries. Every package listed here is built from this repository — versions and descriptions come straight from each package's own manifest."
        actions={
          <ButtonLink href={`${base}/quickstart`} variant="primary">
            Quickstart
          </ButtonLink>
        }
      />

      <section className="rounded-lg border border-info-line bg-info-subtle p-4">
        <p className="text-sm leading-relaxed text-info-text">
          <span className="font-medium">One rule splits these packages:</span> server SDKs authenticate with a permanent
          project API key and mint tokens; the browser SDK only ever receives an already-minted token. Never install{' '}
          <span className="font-mono text-xs">@corvidhq/server</span> or{' '}
          <span className="font-mono text-xs">raven-sdk</span> into anything that ships to a browser.
        </p>
      </section>

      <div className="flex flex-col gap-5">
        {SDKS.map((sdk) => (
          <SdkCard key={sdk.name} sdk={sdk} />
        ))}
      </div>

      <Card>
        <CardHeader
          title="Also in the toolchain"
          subtitle="Not an SDK, but built and versioned alongside them."
        />
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="font-mono text-sm font-medium text-fg">@corvidhq/cli</span>
            <Badge tone="neutral">v0.1.0</Badge>
          </div>
          <p className="text-sm leading-relaxed text-muted">
            Manage projects, API keys, and rooms from the terminal, and wire up a local app for RTC development.
          </p>
          <a
            href={`${base}/cli`}
            className="mt-2 inline-flex w-fit items-center gap-1.5 text-xs font-medium text-accent-text hover:underline"
          >
            Full command reference →
          </a>
        </div>
      </Card>

      <Card>
        <CardHeader title="Not available" subtitle="Stated so you don't go looking." />
        <ul className="flex flex-col gap-2 text-sm leading-relaxed text-muted">
          <li>
            <span className="font-medium text-fg">Native mobile.</span> React Native, Flutter, iOS and Android are
            explicitly out of scope for <span className="font-mono text-xs">@corvidhq/rtc</span>, which targets current
            versions of Chrome, Firefox, Safari and Edge.
          </li>
          <li>
            <span className="font-medium text-fg">Other server languages.</span> Node.js and Python are the only server
            SDKs. Any other backend talks to the Control API over plain HTTP — see the curl tab in the{' '}
            <a href={`${base}/quickstart`} className="text-accent-text hover:underline">
              quickstart
            </a>
            .
          </li>
        </ul>
      </Card>
    </div>
  );
}

function SdkCard({ sdk }: { sdk: SdkEntry }) {
  return (
    <Card padded={false}>
      <div className="border-b border-line px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-mono text-sm font-semibold text-fg">{sdk.name}</h2>
          <Badge tone="neutral">v{sdk.version}</Badge>
          <Badge tone={sdk.surface === 'server' ? 'warning' : 'accent'}>{SURFACE_LABEL[sdk.surface]}</Badge>
        </div>
        <p className="mt-2 text-sm font-medium text-fg">{sdk.headline}</p>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">{sdk.description}</p>
      </div>

      <div className="grid grid-cols-1 gap-5 p-5 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <div>
            <h3 className="mb-2 text-xs font-semibold text-muted">Install</h3>
            <CodeBlock language={sdk.install.language} code={sdk.install.code} />
          </div>
          <div>
            <h3 className="mb-2 text-xs font-semibold text-muted">Reference</h3>
            {sdk.docsHref ? (
              <a
                href={sdk.docsHref}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-accent-text hover:underline"
              >
                {sdk.docsLabel}
                <IconExternal className="size-3" />
              </a>
            ) : (
              <p className="text-xs leading-relaxed text-subtle">{sdk.docsNote}</p>
            )}
          </div>
        </div>

        <div className="min-w-0">
          <h3 className="mb-2 text-xs font-semibold text-muted">Minimal usage</h3>
          <CodeBlock language={sdk.usage.language} code={sdk.usage.code} />
        </div>
      </div>
    </Card>
  );
}
