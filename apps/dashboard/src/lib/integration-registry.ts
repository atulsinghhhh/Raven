import type { Project } from './api-client';

/**
 * Single source of truth for the integration wizard (quickstart page) and
 * the generated README/shareable guide — both render from the exact same
 * `IntegrationEntry`, so they can never drift from each other.
 *
 * Every snippet below is adapted from code that already exists and is
 * already verified against the real SDKs in this repo: the quickstart
 * page's RTC snippets, `packages/chat-sdk/README.md`, `packages/server-sdk/src/resources/*`,
 * `packages/client/src/live/live-stream.ts`, and the real
 * `examples/react-video-call` and `examples/video-call` example apps.
 * Nothing here is invented — see each entry's `source` comment.
 *
 * There is no separate "publishable"/client-safe API key in this system
 * (only one kind of key exists, and it never leaves a backend — see
 * `SecurityCallout` on the quickstart page). Every `env.client` array below
 * is therefore empty: the browser never holds a Raven credential of any
 * kind, only a short-lived token grant fetched at runtime from your own
 * backend endpoint.
 */

export type Product = 'rtc' | 'chat' | 'live-streaming';
export type Language = 'typescript';
export type Framework = 'nextjs' | 'react' | 'vanilla' | 'node';

export const PRODUCTS: { id: Product; label: string; description: string; examples: string[] }[] = [
  {
    id: 'rtc',
    label: 'RTC',
    description: 'Audio/video calling.',
    examples: ['video calls', 'voice calls', 'meetings', '1:1 calls', 'group calls'],
  },
  {
    id: 'chat',
    label: 'Chat',
    description: 'Real-time messaging.',
    examples: ['direct messages', 'group chat', 'conversations', 'presence', 'typing indicators'],
  },
  {
    id: 'live-streaming',
    label: 'Live Streaming',
    description: 'Live video broadcasting.',
    examples: ['live events', 'creator streaming', 'webinars', 'broadcasts'],
  },
];

export const LANGUAGES: { id: Language | 'python' | 'dart'; label: string; supported: boolean }[] = [
  { id: 'typescript', label: 'TypeScript / JavaScript', supported: true },
  { id: 'python', label: 'Python', supported: false },
  { id: 'dart', label: 'Dart (Flutter)', supported: false },
];

export const FRAMEWORKS: { id: Framework; label: string; language: Language }[] = [
  { id: 'nextjs', label: 'Next.js', language: 'typescript' },
  { id: 'react', label: 'React (Vite)', language: 'typescript' },
  { id: 'vanilla', label: 'Vanilla JavaScript', language: 'typescript' },
  { id: 'node', label: 'Node.js (backend only)', language: 'typescript' },
];

export interface EnvVar {
  name: string;
  description: string;
  example?: string;
}

export interface CodeFile {
  path: string;
  language: string;
  code: string;
}

export interface IntegrationEntry {
  product: Product;
  framework: Framework;
  supported: true;
  packages: { server?: string; client?: string };
  install: { npm: string; pnpm: string; yarn: string; bun: string };
  env: { client: EnvVar[]; server: EnvVar[] };
  files: CodeFile[];
  runCommand: string;
  checks: { id: string; label: string }[];
  source: string;
}

export interface UnsupportedEntry {
  product: Product;
  framework: Framework;
  supported: false;
  reason: string;
  alternative: string;
}

const SERVER_ENV: EnvVar[] = [
  {
    name: 'RAVEN_API_KEY',
    description: 'Server-only. Mints tokens; never send it to a browser, never commit it.',
    example: 'rvk_dev_yourKeyId.yourSecret',
  },
  {
    name: 'RAVEN_API_URL',
    description: 'Your Raven Control API deployment. Optional — defaults to http://localhost:4100.',
    example: 'http://localhost:4100',
  },
];

function installCommands(pkgs: string[]): IntegrationEntry['install'] {
  const list = pkgs.join(' ');
  return {
    npm: `npm install ${list}`,
    pnpm: `pnpm add ${list}`,
    yarn: `yarn add ${list}`,
    bun: `bun add ${list}`,
  };
}

// ---------------------------------------------------------------------------
// RTC
//
// Source: quickstart/page.tsx's NODE_TOKEN/BROWSER_JOIN/BROWSER_PUBLISH/
// BROWSER_EVENTS (server mint + createRTCClient), and the real <RavenRoom>
// component + useCamera/useMicrophone/useLocalParticipant/useRemoteParticipants
// hooks from examples/react-video-call/src/App.tsx.
// ---------------------------------------------------------------------------

const RTC_SERVER_FILE = (path: string): CodeFile => ({
  path,
  language: 'typescript',
  code: `import { Raven } from '@ravenkash/server';

const raven = new Raven({
  apiKey: process.env.RAVEN_API_KEY!,
  baseUrl: process.env.RAVEN_API_URL, // defaults to http://localhost:4100
});

// Your own auth decides who "identity" is — never trust a client-supplied id.
export async function mintRtcToken(identity: string, roomName: string) {
  const room = await raven.rooms.create({ name: roomName });

  const issued = await raven.tokens.create({
    room: room.id,
    identity,
    permissions: { join: true, subscribe: true, publish: true, publishAudio: true, publishVideo: true },
    expiresIn: 3600,
  });

  // Forward these fields to the browser. Never the API key.
  return {
    roomId: issued.roomId,
    roomName,
    token: issued.token,
    endpoint: issued.endpoint,
    iceServers: issued.iceServers,
    telemetryUrl: issued.telemetryUrl,
  };
}`,
});

const RTC_NEXTJS_ROUTE: CodeFile = {
  path: 'app/api/rtc-token/route.ts',
  language: 'typescript',
  code: `import { NextResponse } from 'next/server';
import { mintRtcToken } from '@/lib/raven';

export async function POST(request: Request) {
  const { identity, roomName } = await request.json();
  return NextResponse.json(await mintRtcToken(identity, roomName));
}`,
};

const RTC_NEXTJS_CLIENT: CodeFile = {
  path: 'app/call/page.tsx',
  language: 'tsx',
  code: `'use client';

import { useState } from 'react';
import { RavenRoom, useCamera, useLocalParticipant, useMicrophone, useRemoteParticipants } from '@ravenkash/react';

export default function CallPage() {
  const [session, setSession] = useState<Awaited<ReturnType<typeof fetchSession>> | null>(null);

  async function fetchSession() {
    const res = await fetch('/api/rtc-token', {
      method: 'POST',
      body: JSON.stringify({ identity: 'alice', roomName: 'standup' }),
    });
    return res.json();
  }

  if (!session) {
    return <button onClick={() => fetchSession().then(setSession)}>Join call</button>;
  }

  return (
    <RavenRoom
      token={session.token}
      endpoint={session.endpoint}
      room={session.roomName}
      iceServers={session.iceServers}
      telemetryUrl={session.telemetryUrl}
      fallback={<p>Connecting…</p>}
      onError={(error) => alert(\`Join failed: \${error.code}\`)}
    >
      <CallScreen />
    </RavenRoom>
  );
}

function CallScreen() {
  const local = useLocalParticipant();
  const remote = useRemoteParticipants();
  const camera = useCamera();
  const microphone = useMicrophone();

  return (
    <div>
      <button onClick={() => (camera.enabled ? camera.disable() : camera.enable())}>
        Camera: {camera.enabled ? 'on' : 'off'}
      </button>
      <button onClick={() => (microphone.enabled ? microphone.disable() : microphone.enable())}>
        Mic: {microphone.enabled ? 'on' : 'off'}
      </button>
      <p>You: {local?.identity}</p>
      <p>Participants: {remote.map((p) => p.identity).join(', ') || 'none yet'}</p>
    </div>
  );
}`,
};

const RTC_REACT_CLIENT: CodeFile = {
  ...RTC_NEXTJS_CLIENT,
  path: 'src/App.tsx',
};

const RTC_VANILLA_HTML: CodeFile = {
  path: 'index.html',
  language: 'html',
  code: `<!doctype html>
<html>
  <body>
    <button id="joinButton">Join</button>
    <div id="localVideo"></div>
    <div id="remoteVideos"></div>
    <script type="module" src="./main.js"></script>
  </body>
</html>`,
};

const RTC_VANILLA_JS: CodeFile = {
  path: 'main.js',
  language: 'javascript',
  code: `import { createRTCClient } from '@ravenkash/rtc';

document.getElementById('joinButton').addEventListener('click', async () => {
  const session = await fetch('/api/rtc-token', {
    method: 'POST',
    body: JSON.stringify({ identity: 'alice', roomName: 'standup' }),
  }).then((r) => r.json());

  const client = createRTCClient({
    token: session.token,
    endpoint: session.endpoint,
    iceServers: session.iceServers,
    telemetryUrl: session.telemetryUrl,
  });

  const room = await client.join(session.roomName);
  await room.enableCamera();
  await room.enableMicrophone();

  room.on('trackSubscribed', (track) => {
    document.getElementById('remoteVideos').appendChild(track.attach());
  });
});`,
};

const RTC_CHECKS = [
  { id: 'apiKey', label: 'API credentials' },
  { id: 'signaling', label: 'Signaling' },
  { id: 'sfu', label: 'SFU (media plane)' },
  { id: 'turn', label: 'TURN' },
];

const RTC_ENTRIES: IntegrationEntry[] = [
  {
    product: 'rtc',
    framework: 'nextjs',
    supported: true,
    packages: { server: '@ravenkash/server', client: '@ravenkash/react @ravenkash/rtc' },
    install: installCommands(['@ravenkash/server', '@ravenkash/react', '@ravenkash/rtc']),
    env: { client: [], server: SERVER_ENV },
    files: [RTC_SERVER_FILE('lib/raven.ts'), RTC_NEXTJS_ROUTE, RTC_NEXTJS_CLIENT],
    runCommand: 'npm run dev',
    checks: RTC_CHECKS,
    source: 'quickstart/page.tsx (NODE_TOKEN) + examples/react-video-call/src/App.tsx (RavenRoom, real hooks)',
  },
  {
    product: 'rtc',
    framework: 'react',
    supported: true,
    packages: { server: '@ravenkash/server', client: '@ravenkash/react @ravenkash/rtc' },
    install: installCommands(['@ravenkash/react', '@ravenkash/rtc']),
    env: { client: [], server: SERVER_ENV },
    files: [
      { ...RTC_SERVER_FILE('server/raven.ts'), path: 'server/raven.ts' },
      { ...RTC_NEXTJS_ROUTE, path: 'server/routes/rtc-token.ts', code: RTC_NEXTJS_ROUTE.code.replace('@/lib/raven', '../raven') },
      RTC_REACT_CLIENT,
    ],
    runCommand: 'npm run dev   # Vite dev server — run your Node backend separately',
    checks: RTC_CHECKS,
    source: 'examples/react-video-call/src/App.tsx (real, already-running example) + quickstart NODE_TOKEN',
  },
  {
    product: 'rtc',
    framework: 'vanilla',
    supported: true,
    packages: { server: '@ravenkash/server', client: '@ravenkash/rtc' },
    install: installCommands(['@ravenkash/rtc']),
    env: { client: [], server: SERVER_ENV },
    files: [RTC_SERVER_FILE('server.js'), RTC_VANILLA_HTML, RTC_VANILLA_JS],
    runCommand: 'node server.js   # then open index.html',
    checks: RTC_CHECKS,
    source: 'examples/video-call/app.js (real, already-running example) + quickstart NODE_TOKEN',
  },
  {
    product: 'rtc',
    framework: 'node',
    supported: true,
    packages: { server: '@ravenkash/server' },
    install: installCommands(['@ravenkash/server']),
    env: { client: [], server: SERVER_ENV },
    files: [RTC_SERVER_FILE('server.js')],
    runCommand: 'node server.js',
    checks: RTC_CHECKS,
    source: 'quickstart/page.tsx NODE_TOKEN — backend-only; pick a client framework separately for the browser half',
  },
];

// ---------------------------------------------------------------------------
// Chat
//
// Source: packages/chat-sdk/README.md (createChatClient/connect/sendMessage/
// on('message')), packages/server-sdk/src/resources/chat.ts
// (createToken/createConversation), packages/react-sdk/src/chat/chat-hooks.ts
// (useChat/useMessages — verified real hook shapes).
// ---------------------------------------------------------------------------

const CHAT_SERVER_FILE = (path: string): CodeFile => ({
  path,
  language: 'typescript',
  code: `import { Raven } from '@ravenkash/server';

const raven = new Raven({
  apiKey: process.env.RAVEN_API_KEY!,
  baseUrl: process.env.RAVEN_API_URL,
});

export async function mintChatToken(userId: string, conversation: string) {
  await raven.chat.createConversation({ name: conversation }).catch(() => undefined); // idempotent-ish: ignore "already exists"

  // Forward this to the browser. Never the API key.
  return raven.chat.createToken({ userId, conversations: [conversation] });
}`,
});

const CHAT_NEXTJS_ROUTE: CodeFile = {
  path: 'app/api/chat-token/route.ts',
  language: 'typescript',
  code: `import { NextResponse } from 'next/server';
import { mintChatToken } from '@/lib/raven-chat';

export async function POST(request: Request) {
  const { userId, conversation } = await request.json();
  return NextResponse.json(await mintChatToken(userId, conversation));
}`,
};

const CHAT_REACT_HOOKS_CLIENT = (path: string): CodeFile => ({
  path,
  language: 'tsx',
  code: `'use client';

import { useEffect, useState } from 'react';
import { useChat, useMessages } from '@ravenkash/react/chat';

export function ChatPanel({ conversation }: { conversation: string }) {
  const { connect } = useChat();
  const { messages, send } = useMessages();
  const [draft, setDraft] = useState('');

  useEffect(() => {
    connect(conversation);
  }, [connect, conversation]);

  return (
    <div>
      <ul>
        {messages.map((m) => (
          <li key={m.id}>{m.text}</li>
        ))}
      </ul>
      <input value={draft} onChange={(e) => setDraft(e.target.value)} />
      <button
        onClick={() => {
          send(draft);
          setDraft('');
        }}
      >
        Send
      </button>
    </div>
  );
}`,
});

const CHAT_VANILLA_JS: CodeFile = {
  path: 'main.js',
  language: 'javascript',
  code: `import { createChatClient } from '@ravenkash/chat';

const grant = await fetch('/api/chat-token', {
  method: 'POST',
  body: JSON.stringify({ userId: 'alice', conversation: 'general' }),
}).then((r) => r.json());

const chat = createChatClient({ token: grant.token, apiUrl: grant.apiUrl });

await chat.connect({ room: 'general' });

chat.on('message', (message) => console.log(message));

await chat.sendMessage({ text: 'Hello' });`,
};

const CHAT_CHECKS = [
  { id: 'apiKey', label: 'API credentials' },
  { id: 'signaling', label: 'Chat gateway' },
];

const CHAT_ENTRIES: IntegrationEntry[] = [
  {
    product: 'chat',
    framework: 'nextjs',
    supported: true,
    packages: { server: '@ravenkash/server', client: '@ravenkash/react @ravenkash/chat' },
    install: installCommands(['@ravenkash/server', '@ravenkash/react', '@ravenkash/chat']),
    env: { client: [], server: SERVER_ENV },
    files: [CHAT_SERVER_FILE('lib/raven-chat.ts'), CHAT_NEXTJS_ROUTE, CHAT_REACT_HOOKS_CLIENT('app/chat/page.tsx')],
    runCommand: 'npm run dev',
    checks: CHAT_CHECKS,
    source: 'packages/chat-sdk/README.md + packages/react-sdk/src/chat/chat-hooks.ts (useChat/useMessages)',
  },
  {
    product: 'chat',
    framework: 'react',
    supported: true,
    packages: { server: '@ravenkash/server', client: '@ravenkash/react @ravenkash/chat' },
    install: installCommands(['@ravenkash/react', '@ravenkash/chat']),
    env: { client: [], server: SERVER_ENV },
    files: [
      { ...CHAT_SERVER_FILE('server/raven-chat.ts') },
      { ...CHAT_NEXTJS_ROUTE, path: 'server/routes/chat-token.ts', code: CHAT_NEXTJS_ROUTE.code.replace('@/lib/raven-chat', '../raven-chat') },
      CHAT_REACT_HOOKS_CLIENT('src/ChatPanel.tsx'),
    ],
    runCommand: 'npm run dev   # Vite dev server — run your Node backend separately',
    checks: CHAT_CHECKS,
    source: 'packages/react-sdk/src/chat/chat-hooks.ts (real hook shapes) + chat-sdk README',
  },
  {
    product: 'chat',
    framework: 'vanilla',
    supported: true,
    packages: { server: '@ravenkash/server', client: '@ravenkash/chat' },
    install: installCommands(['@ravenkash/chat']),
    env: { client: [], server: SERVER_ENV },
    files: [CHAT_SERVER_FILE('server.js'), CHAT_VANILLA_JS],
    runCommand: 'node server.js',
    checks: CHAT_CHECKS,
    source: 'packages/chat-sdk/README.md — verbatim createChatClient usage',
  },
  {
    product: 'chat',
    framework: 'node',
    supported: true,
    packages: { server: '@ravenkash/server' },
    install: installCommands(['@ravenkash/server']),
    env: { client: [], server: SERVER_ENV },
    files: [CHAT_SERVER_FILE('server.js')],
    runCommand: 'node server.js',
    checks: CHAT_CHECKS,
    source: 'packages/server-sdk/src/resources/chat.ts — backend-only',
  },
];

// ---------------------------------------------------------------------------
// Live Streaming
//
// Source: packages/server-sdk/src/resources/live-streams.ts (create/start/
// addHost/createViewerToken) and packages/client/src/live/live-stream.ts
// (LiveStream.join — real class, verified doc example).
// ---------------------------------------------------------------------------

const LIVE_SERVER_FILE = (path: string): CodeFile => ({
  path,
  language: 'typescript',
  code: `import { Raven } from '@ravenkash/server';

const raven = new Raven({
  apiKey: process.env.RAVEN_API_KEY!,
  baseUrl: process.env.RAVEN_API_URL,
});

export async function startStream(title: string, hostIdentity: string) {
  const stream = await raven.liveStreams.create({ title });
  await raven.liveStreams.start(stream.id);
  // Forward this to the host's device. Never the API key.
  return raven.liveStreams.addHost(stream.id, { identity: hostIdentity });
}

export async function mintViewerCredentials(streamId: string, identity: string) {
  // Always subscribe-only — this SDK has no way to grant a viewer publish access.
  return raven.liveStreams.createViewerToken(streamId, identity);
}`,
});

const LIVE_NEXTJS_ROUTES: CodeFile[] = [
  {
    path: 'app/api/live/host/route.ts',
    language: 'typescript',
    code: `import { NextResponse } from 'next/server';
import { startStream } from '@/lib/raven-live';

export async function POST(request: Request) {
  const { title, hostIdentity } = await request.json();
  return NextResponse.json(await startStream(title, hostIdentity));
}`,
  },
  {
    path: 'app/api/live/viewer/route.ts',
    language: 'typescript',
    code: `import { NextResponse } from 'next/server';
import { mintViewerCredentials } from '@/lib/raven-live';

export async function POST(request: Request) {
  const { streamId, identity } = await request.json();
  return NextResponse.json(await mintViewerCredentials(streamId, identity));
}`,
  },
];

const LIVE_CLIENT = (path: string): CodeFile => ({
  path,
  language: 'typescript',
  code: `import { LiveStream } from '@ravenkash/client';

// credentials come from POST /api/live/host (or /api/live/viewer) above —
// never minted in the browser.
const credentials = await fetch('/api/live/host', {
  method: 'POST',
  body: JSON.stringify({ title: 'My first stream', hostIdentity: 'alice' }),
}).then((r) => r.json());

const stream = await LiveStream.join(credentials);

if (stream.isHost) {
  await stream.room.enableCamera();
  await stream.room.enableMicrophone();
}

stream.room.on('trackSubscribed', (track) => {
  document.querySelector('#stage')?.appendChild(track.attach());
});`,
});

const LIVE_CHECKS = [
  { id: 'apiKey', label: 'API credentials' },
  { id: 'sfu', label: 'SFU (media plane)' },
  { id: 'turn', label: 'TURN' },
];

const LIVE_ENTRIES: IntegrationEntry[] = [
  {
    product: 'live-streaming',
    framework: 'nextjs',
    supported: true,
    packages: { server: '@ravenkash/server', client: '@ravenkash/client' },
    install: installCommands(['@ravenkash/server', '@ravenkash/client']),
    env: { client: [], server: SERVER_ENV },
    files: [LIVE_SERVER_FILE('lib/raven-live.ts'), ...LIVE_NEXTJS_ROUTES, LIVE_CLIENT('app/live/page.tsx')],
    runCommand: 'npm run dev',
    checks: LIVE_CHECKS,
    source: 'packages/server-sdk/src/resources/live-streams.ts + packages/client/src/live/live-stream.ts (LiveStream.join)',
  },
  {
    product: 'live-streaming',
    framework: 'react',
    supported: true,
    packages: { server: '@ravenkash/server', client: '@ravenkash/client' },
    install: installCommands(['@ravenkash/client']),
    env: { client: [], server: SERVER_ENV },
    files: [
      { ...LIVE_SERVER_FILE('server/raven-live.ts') },
      LIVE_CLIENT('src/live.ts'),
    ],
    runCommand: 'npm run dev   # Vite dev server — run your Node backend separately',
    checks: LIVE_CHECKS,
    source: 'packages/client/src/live/live-stream.ts — no dedicated React hook exists yet, so this uses the same real client class directly',
  },
  {
    product: 'live-streaming',
    framework: 'vanilla',
    supported: true,
    packages: { server: '@ravenkash/server', client: '@ravenkash/client' },
    install: installCommands(['@ravenkash/client']),
    env: { client: [], server: SERVER_ENV },
    files: [LIVE_SERVER_FILE('server.js'), LIVE_CLIENT('main.js')],
    runCommand: 'node server.js',
    checks: LIVE_CHECKS,
    source: 'packages/client/src/live/live-stream.ts (doc example, verbatim)',
  },
  {
    product: 'live-streaming',
    framework: 'node',
    supported: true,
    packages: { server: '@ravenkash/server' },
    install: installCommands(['@ravenkash/server']),
    env: { client: [], server: SERVER_ENV },
    files: [LIVE_SERVER_FILE('server.js')],
    runCommand: 'node server.js',
    checks: LIVE_CHECKS,
    source: 'packages/server-sdk/src/resources/live-streams.ts — backend-only',
  },
];

const ALL_ENTRIES: IntegrationEntry[] = [...RTC_ENTRIES, ...CHAT_ENTRIES, ...LIVE_ENTRIES];

export function getIntegrationEntry(
  product: Product,
  language: Language | string,
  framework: Framework | string,
): IntegrationEntry | UnsupportedEntry {
  if (language !== 'typescript') {
    return {
      product,
      framework: framework as Framework,
      supported: false,
      reason: `${language} is not yet supported for browser/server integration examples.`,
      alternative:
        language === 'python'
          ? 'Python is supported for server-side use only (install via git — see the SDKs page). For the browser half, pick a TypeScript/JavaScript framework above.'
          : 'This language is coming soon. Pick TypeScript/JavaScript for a working integration today.',
    };
  }

  const entry = ALL_ENTRIES.find((e) => e.product === product && e.framework === framework);
  if (!entry) {
    return {
      product,
      framework: framework as Framework,
      supported: false,
      reason: `This combination isn't available yet.`,
      alternative: 'Choose Next.js, React (Vite), Vanilla JavaScript, or Node.js (backend only).',
    };
  }
  return entry;
}

export function isSupported(entry: IntegrationEntry | UnsupportedEntry): entry is IntegrationEntry {
  return entry.supported;
}

/**
 * Renders the same entry the wizard shows into a short, shareable Markdown
 * guide — "Copy integration guide" (spec §21/§22). Pure function over the
 * same data the UI renders, so the two can never drift.
 */
export function renderIntegrationReadme(entry: IntegrationEntry, project: Pick<Project, 'id' | 'name'>): string {
  const productLabel = PRODUCTS.find((p) => p.id === entry.product)?.label ?? entry.product;
  const frameworkLabel = FRAMEWORKS.find((f) => f.id === entry.framework)?.label ?? entry.framework;

  const lines: string[] = [
    `# Raven Integration — ${project.name}`,
    ``,
    `TypeScript + ${frameworkLabel} + ${productLabel}`,
    ``,
    `## 1. Install`,
    ``,
    '```bash',
    entry.install.npm,
    '```',
    ``,
    `## 2. Environment`,
    ``,
    '```env',
    ...entry.env.server.map((v) => `${v.name}=${v.example ?? ''}`),
    '```',
    ``,
    `Never put these in client-side code, \`NEXT_PUBLIC_*\` variables, or version control.`,
    ``,
    `## 3. Code`,
    ``,
    ...entry.files.flatMap((f) => [`### ${f.path}`, '', '```' + f.language, f.code, '```', '']),
    `## 4. Run`,
    ``,
    '```bash',
    entry.runCommand,
    '```',
    ``,
    `## 5. Verify`,
    ``,
    `Open this project's Quickstart page in the Raven dashboard and click "Test your integration", or check: ${entry.checks.map((c) => c.label).join(', ')}.`,
    ``,
    `Project ID: ${project.id}`,
  ];

  return lines.join('\n');
}
