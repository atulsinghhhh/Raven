import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { Card, CardHeader } from '@/components/ui/card';
import { CodeBlock, CodeTabs } from '@/components/ui/code-block';
import { ButtonLink } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { IconChevronRight, IconKeys } from '@/components/ui/icons';
import { DOCS_URL } from '@/lib/nav';

/**
 * Every snippet on this page is checked against the real packages:
 * `createRTCClient`/`Room` from packages/sdk/src, `Raven` +
 * `tokens.create`/`rooms.create` from packages/server-sdk/src, and the
 * same two calls from sdks/python/src/raven. Nothing here is aspirational
 *: if an API isn't in those files, it isn't on this page.
 */
export default async function QuickstartPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const token = await getSessionToken();
  if (!token) redirect('/login');

  const base = `/dashboard/projects/${projectId}`;

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <PageHeader
        title="Quickstart"
        description="From an empty project to two people on a call. Each step below uses only APIs that exist in this repository's SDKs today."
        actions={
          <ButtonLink href={`${base}/sdks`} variant="secondary">
            All SDKs
          </ButtonLink>
        }
      />

      <SecurityCallout />

      <ol className="flex flex-col gap-8">
        <Step
          n={1}
          title="Install the SDKs"
          description="One package in the browser, one on your backend. The backend package holds the API key; the browser package never sees it."
        >
          <CodeTabs
            samples={[
              { label: 'Browser', language: 'bash', code: 'npm install @ravenkash/rtc' },
              { label: 'Node.js backend', language: 'bash', code: 'npm install @ravenkash/server' },
              // Deliberately not `pip install raven-sdk`: that name on PyPI is an
              // unrelated third-party package. See docs/releases.md#python--raven-sdk.
              {
                label: 'Python backend',
                language: 'bash',
                code: 'pip install "git+https://github.com/atulsinghhhh/Raven.git#subdirectory=sdks/python"',
              },
            ]}
          />
        </Step>

        <Step
          n={2}
          title="Create an API key"
          description="A key is scoped to this project and is shown in full exactly once. Put it in your backend's environment — never in frontend code or version control."
        >
          <div className="flex flex-col gap-3">
            <a
              href={`${base}/api-keys`}
              className="group flex items-center gap-3 rounded-lg border border-line bg-surface-raised p-3.5 transition-colors hover:border-line-strong"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent-subtle text-accent">
                <IconKeys className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-fg">Open API Keys</span>
                <span className="block text-xs text-muted">Create a key, then copy it straight into your secret store.</span>
              </span>
              <IconChevronRight className="size-4 shrink-0 text-subtle transition-transform group-hover:translate-x-0.5" />
            </a>
            <CodeBlock
              language="bash"
              code={`# On your backend host or in your secret manager — never in the browser bundle.
export RAVEN_API_KEY="rvk_yourKeyId.yourSecret"
export RAVEN_API_URL="http://localhost:4100"   # your Raven Control API deployment`}
            />
          </div>
        </Step>

        <Step
          n={3}
          title="Mint an RTC token on your backend"
          description="Your backend exchanges the API key for a short-lived, room-scoped token, then forwards the token, endpoint and ICE servers to the browser. Tokens expire; API keys do not."
        >
          <CodeTabs
            samples={[
              { label: 'Node.js', language: 'typescript', code: NODE_TOKEN },
              { label: 'Python', language: 'python', code: PYTHON_TOKEN },
              { label: 'curl', language: 'bash', code: CURL_TOKEN },
            ]}
          />
          <p className="mt-3 text-xs leading-relaxed text-muted">
            The mint response carries <code className="font-mono text-fg">token</code>,{' '}
            <code className="font-mono text-fg">endpoint</code>,{' '}
            <code className="font-mono text-fg">iceServers</code>,{' '}
            <code className="font-mono text-fg">telemetryUrl</code> and{' '}
            <code className="font-mono text-fg">roomId</code>. Forward those to your frontend as-is — don&apos;t
            hand-build STUN/TURN configuration yourself.
          </p>
        </Step>

        <Step
          n={4}
          title="Join the room in the browser"
          description="createRTCClient takes exactly what your backend returned. The SDK never calls the Control API itself — it only ever receives an already-minted token."
        >
          <CodeBlock language="typescript" code={BROWSER_JOIN} />
        </Step>

        <Step
          n={5}
          title="Publish camera and microphone"
          description="Permission prompts, track creation and publishing are all handled for you. Each call resolves once the track is live."
        >
          <CodeBlock language="typescript" code={BROWSER_PUBLISH} />
        </Step>

        <Step
          n={6}
          title="Handle remote participants and events"
          description="Room is a typed event emitter. Attach a subscribed track to a media element and it starts playing — no SDP, ICE candidates, or RTCPeerConnection anywhere."
        >
          <CodeBlock language="typescript" code={BROWSER_EVENTS} />
        </Step>

        <Step
          n={7}
          title="Leave"
          description="Leaving unpublishes local tracks and tears the connection down. Calling it on unmount is enough to clean up a call UI."
        >
          <CodeBlock language="typescript" code={BROWSER_LEAVE} />
        </Step>
      </ol>

      <Card>
        <CardHeader title="Where to go next" subtitle="Everything below reflects code that exists in this repository." />
        <ul className="flex flex-col gap-2.5 text-sm">
          <NextLink href={`${base}/sdks`}>
            SDK reference — <span className="font-mono text-xs">@ravenkash/rtc</span>,{' '}
            <span className="font-mono text-xs">@ravenkash/server</span>,{' '}
            <span className="font-mono text-xs">raven-sdk</span> and{' '}
            <span className="font-mono text-xs">@ravenkash/react</span>
          </NextLink>
          <NextLink href={`${base}/rooms`}>Rooms — inspect live participants and mint a test token from the dashboard</NextLink>
          <NextLink href={`${base}/connections`}>
            Connections — every join shows up here, keyed by the <span className="font-mono text-xs">connectionId</span>{' '}
            above
          </NextLink>
          <NextLink href={`${base}/errors`}>Errors — categorised failures with likely cause and suggested action</NextLink>
          <NextLink href={`${DOCS_URL}/sdk.md`}>Full browser SDK reference (docs/sdk.md)</NextLink>
        </ul>
      </Card>
    </div>
  );
}

function NextLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <a href={href} className="group inline-flex items-baseline gap-1.5 text-muted transition-colors hover:text-fg">
        <IconChevronRight className="size-3 shrink-0 translate-y-0.5 text-subtle transition-transform group-hover:translate-x-0.5" />
        <span>{children}</span>
      </a>
    </li>
  );
}

/** The one thing on this page that is genuinely dangerous to get wrong. */
function SecurityCallout() {
  return (
    <section className="rounded-lg border border-warning-line bg-warning-subtle p-5">
      <div className="flex gap-3">
        <span aria-hidden="true" className="mt-0.5 shrink-0 text-warning-text">
          <svg viewBox="0 0 16 16" className="size-5" fill="currentColor">
            <path d="M8 1l5.5 2.2v4.1c0 3.2-2.2 6.1-5.5 7.2-3.3-1.1-5.5-4-5.5-7.2V3.2L8 1zm0 4a.75.75 0 00-.75.75v2.8a.75.75 0 001.5 0V5.75A.75.75 0 008 5zm0 6.6a1 1 0 100-2 1 1 0 000 2z" />
          </svg>
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-warning-text">Mint tokens on your server, never in the browser</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-warning-text">
            An API key is permanent and can mint a token for any room in this project. It belongs only on a backend you
            control. The browser receives a short-lived RTC token scoped to one room and one participant identity — if
            that leaks, it expires on its own. If an API key leaks, revoke it immediately on the API Keys page.
          </p>
        </div>
      </div>
    </section>
  );
}

function Step({
  n,
  title,
  description,
  children,
}: {
  n: number;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-4">
      <div className="flex flex-col items-center gap-2">
        <span className="tabular flex size-7 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-xs font-semibold text-muted">
          {n}
        </span>
        <span aria-hidden="true" className="w-px flex-1 bg-line" />
      </div>
      <div className="min-w-0 flex-1 pb-1">
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
        <p className="mt-1 mb-3 text-sm leading-relaxed text-muted">{description}</p>
        {children}
      </div>
    </li>
  );
}

const NODE_TOKEN = `import { Raven } from '@ravenkash/server';

// The SDK never reads env vars on its own: pass the key explicitly.
const raven = new Raven({
  apiKey: process.env.RAVEN_API_KEY!,
  baseUrl: process.env.RAVEN_API_URL, // defaults to http://localhost:4100
});

// Rooms are control-plane records. Create one, or reuse an ID from raven.rooms.list().
const room = await raven.rooms.create({ name: 'standup' });

// Your own auth decides who "alice" is. Raven only mints for who you say.
const issued = await raven.tokens.create({
  room: room.id,
  identity: 'alice',
  permissions: { join: true, subscribe: true, publish: true, publishAudio: true, publishVideo: true },
  expiresIn: 3600,
});

// Forward these fields to the browser. Never the API key.
return {
  roomId: issued.roomId,
  token: issued.token,
  endpoint: issued.endpoint,
  iceServers: issued.iceServers,
  telemetryUrl: issued.telemetryUrl,
};`;

const PYTHON_TOKEN = `import os
from raven import Raven, CreateTokenParams, TokenPermissions

raven = Raven(
    api_key=os.environ["RAVEN_API_KEY"],
    base_url=os.environ.get("RAVEN_API_URL", "http://localhost:4100"),
)

room = raven.rooms.create(name="standup")

issued = raven.tokens.create(
    CreateTokenParams(
        room=room["id"],
        identity="alice",
        permissions=TokenPermissions(
            join=True, subscribe=True, publish=True, publish_audio=True, publish_video=True
        ),
        expires_in=3600,
    )
)

# Forward these fields to the browser. Never the API key.
payload = {
    "roomId": issued["roomId"],
    "token": issued["token"],
    "endpoint": issued["endpoint"],
    "iceServers": issued["iceServers"],
    "telemetryUrl": issued["telemetryUrl"],
}`;

const CURL_TOKEN = `# ROOM_ID comes from POST /v1/rooms or GET /v1/rooms.
curl -X POST "$RAVEN_API_URL/v1/rooms/$ROOM_ID/rtc-tokens" \\
  -H "Authorization: Bearer $RAVEN_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "participantIdentity": "alice",
    "permissions": { "join": true, "subscribe": true, "publish": true, "publishAudio": true, "publishVideo": true },
    "ttlSeconds": 3600
  }'`;

const BROWSER_JOIN = `import { createRTCClient } from '@ravenkash/rtc';

// Fetched from your own backend endpoint: the one that called tokens.create().
const session = await fetch('/api/rtc-session', { method: 'POST' }).then((r) => r.json());

const client = createRTCClient({
  token: session.token,
  endpoint: session.endpoint,       // forwarded as-is from the token-mint response
  iceServers: session.iceServers,   // forwarded as-is — don't hand-configure STUN/TURN
  telemetryUrl: session.telemetryUrl,
});

// Must be the room the token was minted for, or this throws ROOM_NOT_FOUND
// immediately, before any connection is attempted.
const room = await client.join(session.roomId);

// Quote this in a bug report: it's the same ID the Connections page shows.
console.log('connectionId:', room.connectionId);`;

const BROWSER_PUBLISH = `// Prompts for device permission, creates the track, and publishes it.
await room.enableCamera();
await room.enableMicrophone();

// Screen share and per-device selection use the same shape.
// await room.enableScreenShare();
// await room.setMicrophoneDevice(deviceId);`;

const BROWSER_EVENTS = `room.on('participantJoined', (participant) => {
  console.log('joined:', participant.identity);
});

room.on('trackSubscribed', (track, participant) => {
  // attach() returns a ready-to-mount <video>/<audio> element.
  const element = track.attach();
  element.dataset.identity = participant.identity;
  document.querySelector('#stage')?.appendChild(element);
});

room.on('trackUnsubscribed', (track) => {
  track.detach().forEach((element) => element.remove());
});

room.on('reconnecting', () => showBanner('Reconnecting…'));
room.on('reconnected', () => hideBanner());

room.on('error', (error) => {
  // RTCError carries a stable code: the same categories the Errors page groups by.
  console.error(error.code, error.message);
});`;

const BROWSER_LEAVE = `await room.leave();`;
