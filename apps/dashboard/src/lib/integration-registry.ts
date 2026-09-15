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
export type Language = 'typescript' | 'dart';
export type Framework = 'nextjs' | 'react' | 'vanilla' | 'node' | 'flutter';

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

// Dart (Flutter) is `supported: true` because real, published integration
// recipes exist for it below (raven_rtc/raven_chat/raven_live, all live on
// pub.dev — see docs/sdk-publication-audit.md). Python stays `false`: it is
// a real, published-to-git server SDK, but this wizard only ever generates
// full client integration examples, and there is no Python client SDK.
// "supported" here means "this language has at least one framework with a
// real recipe below" — per-product/framework availability is still decided
// by `getIntegrationEntry` at lookup time, not by this flag alone.
export const LANGUAGES: { id: Language | 'python'; label: string; supported: boolean }[] = [
  { id: 'typescript', label: 'TypeScript / JavaScript', supported: true },
  { id: 'dart', label: 'Dart (Flutter)', supported: true },
  { id: 'python', label: 'Python', supported: false },
];

export const FRAMEWORKS: { id: Framework; label: string; language: Language }[] = [
  { id: 'nextjs', label: 'Next.js', language: 'typescript' },
  { id: 'react', label: 'React (Vite)', language: 'typescript' },
  { id: 'vanilla', label: 'Vanilla JavaScript', language: 'typescript' },
  { id: 'node', label: 'Node.js (backend only)', language: 'typescript' },
  { id: 'flutter', label: 'Flutter', language: 'dart' },
];

export type PlatformVerification = 'verified' | 'pending';

export interface PlatformStatus {
  id: string;
  label: string;
  verification: PlatformVerification;
  detail: string;
}

/**
 * Per-OS-target verification, keyed by framework. Only Flutter has an
 * entry: every other framework here targets exactly one runtime (a
 * browser, or Node.js), so there is nothing to disambiguate. A framework
 * with no entry renders no platform status at all — this is additive
 * metadata, not a new required field on every `IntegrationEntry`.
 *
 * Flutter's code is the same Dart across every OS target — the platform
 * split lives inside `flutter_webrtc`, below `raven_rtc`, not in anything
 * this wizard generates — so this is a claim about what has actually been
 * *tested*, not about what the code can theoretically run on.
 *
 * Web is `verified`: a real `flutter build web` release build published
 * camera and microphone through a real local SFU to a real browser
 * subscriber, which observed `framesDecoded`/`bytesReceived` actually
 * increase over a sustained window — not merely that signaling completed.
 * See `flutter_check/live_host` and
 * `apps/api/test/flutter-live-streaming.e2e-spec.ts`. Android and iOS are
 * `pending`: this environment has no device or simulator with camera
 * access to test against, and claiming otherwise would be exactly the
 * "package published, therefore supported" leap this system exists to
 * avoid.
 */
export const PLATFORM_STATUS: Partial<Record<Framework, PlatformStatus[]>> = {
  flutter: [
    {
      id: 'web',
      label: 'Web',
      verification: 'verified',
      detail: 'Verified with real live-streaming media, end to end, against a real SFU.',
    },
    { id: 'android', label: 'Android', verification: 'pending', detail: 'Device verification pending.' },
    { id: 'ios', label: 'iOS', verification: 'pending', detail: 'Device verification pending.' },
  ],
};

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

/**
 * One tab in the "Install" step. Modelled as a list rather than a fixed
 * `{npm, pnpm, yarn, bun}` shape so a non-npm ecosystem (Dart's `flutter
 * pub add`, one command, no package-manager choice) fits the same type
 * without a special case — `CodeTabs` already renders an arbitrary list of
 * `{label, language, code}` samples.
 */
export interface InstallCommand {
  label: string;
  language: string;
  code: string;
}

export interface IntegrationEntry {
  product: Product;
  framework: Framework;
  supported: true;
  packages: { server?: string; client?: string };
  install: InstallCommand[];
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
    description: 'Your Raven Control API deployment. Optional — defaults to https://api.ravenstack.online.',
    example: 'https://api.ravenstack.online',
  },
];

function installCommands(pkgs: string[]): InstallCommand[] {
  const list = pkgs.join(' ');
  return [
    { label: 'npm', language: 'bash', code: `npm install ${list}` },
    { label: 'pnpm', language: 'bash', code: `pnpm add ${list}` },
    { label: 'yarn', language: 'bash', code: `yarn add ${list}` },
    { label: 'bun', language: 'bash', code: `bun add ${list}` },
  ];
}

// One command, no package-manager choice — `flutter pub add` is the only
// way pub.dev packages get installed.
function flutterInstallCommand(pkgs: string[]): InstallCommand[] {
  return [{ label: 'flutter pub add', language: 'bash', code: `flutter pub add ${pkgs.join(' ')}` }];
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
  baseUrl: process.env.RAVEN_API_URL, // defaults to https://api.ravenstack.online
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

// Trimmed from the real, running examples/flutter-rtc-chat/lib/main.dart —
// same Raven/RavenRoom/RavenVideoView API, chat panel removed since this is
// the RTC-only recipe. Every method below is real: raven.dart (Raven,
// RavenIceServer), room.dart (join/enableCamera/enableMicrophone/
// remoteParticipants/localParticipant, RavenRoom extends ChangeNotifier),
// video_view.dart (RavenVideoView), permissions.dart (RavenPermissions).
const RTC_FLUTTER_CLIENT: CodeFile = {
  path: 'lib/call_screen.dart',
  language: 'dart',
  code: `import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:raven_rtc/raven_rtc.dart';

// Your app's own backend — never a Raven credential on the device. On a
// real device, localhost means the phone: pass your machine's LAN IP via
// --dart-define, as in the run command below.
const backendUrl = String.fromEnvironment(
  'RAVEN_BACKEND_URL',
  defaultValue: 'http://localhost:3000',
);

class CallScreen extends StatefulWidget {
  const CallScreen({super.key, required this.identity, required this.roomName});

  final String identity;
  final String roomName;

  @override
  State<CallScreen> createState() => _CallScreenState();
}

class _CallScreenState extends State<CallScreen> {
  Raven? _raven;
  RavenRoom? _room;

  @override
  void initState() {
    super.initState();
    unawaited(_connect());
  }

  @override
  void dispose() {
    final raven = _raven;
    if (raven != null) unawaited(raven.leave());
    _room?.dispose();
    super.dispose();
  }

  Future<void> _connect() async {
    // Prompt before joining — discovering a refused camera mid-call is
    // worse than being asked up front.
    await RavenPermissions.request();

    final response = await http.post(
      Uri.parse('\$backendUrl/api/rtc-token'),
      headers: {'content-type': 'application/json'},
      body: jsonEncode({'identity': widget.identity, 'roomName': widget.roomName}),
    );
    final grant = jsonDecode(response.body) as Map<String, dynamic>;

    final raven = Raven(
      token: grant['token'] as String,
      endpoint: grant['endpoint'] as String,
      iceServers: (grant['iceServers'] as List<dynamic>? ?? [])
          .map((s) => RavenIceServer.fromJson(s as Map<String, dynamic>))
          .toList(),
    );
    final room = await raven.join(widget.roomName);
    await room.enableCamera();
    await room.enableMicrophone();

    if (!mounted) {
      // The screen went away while connecting — release instead of
      // leaving a call running behind a dismissed route.
      await raven.leave();
      return;
    }
    setState(() {
      _raven = raven;
      _room = room;
    });
  }

  @override
  Widget build(BuildContext context) {
    final room = _room;
    if (room == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    // RavenRoom is a ChangeNotifier; ListenableBuilder rebuilds this
    // subtree as participants and tracks change.
    return ListenableBuilder(
      listenable: room,
      builder: (context, _) {
        final remotes = room.remoteParticipants;
        final featured = remotes.isEmpty ? null : remotes.first;

        return Scaffold(
          body: Stack(
            children: [
              Positioned.fill(
                child: RavenVideoView(participant: featured, room: room),
              ),
              Positioned(
                right: 16,
                top: 16,
                width: 96,
                height: 140,
                child: RavenVideoView(participant: room.localParticipant, room: room),
              ),
            ],
          ),
        );
      },
    );
  }
}`,
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
      {
        ...RTC_NEXTJS_ROUTE,
        path: 'server/routes/rtc-token.ts',
        code: RTC_NEXTJS_ROUTE.code.replace('@/lib/raven', '../raven'),
      },
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
  {
    product: 'rtc',
    framework: 'flutter',
    supported: true,
    packages: { server: '@ravenkash/server', client: 'raven_rtc' },
    install: flutterInstallCommand(['raven_rtc']),
    env: { client: [], server: SERVER_ENV },
    files: [RTC_SERVER_FILE('server.js'), RTC_FLUTTER_CLIENT],
    runCommand:
      'flutter run --dart-define=RAVEN_BACKEND_URL=http://<your-lan-ip>:3000   # backend runs separately, e.g. node server.js',
    checks: RTC_CHECKS,
    source:
      'sdks/flutter/raven_rtc/lib/src/raven.dart (Raven, join, enableCamera/enableMicrophone) + lib/src/video_view.dart (RavenVideoView) + examples/flutter-rtc-chat/lib/main.dart',
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

// Trimmed from the chat half of examples/flutter-rtc-chat/lib/main.dart.
// Every member is real: chat_client.dart (RavenChat, connect, send,
// messages stream, RavenChat extends ChangeNotifier), models.dart
// (RavenMessage.senderId/.text).
const CHAT_FLUTTER_CLIENT: CodeFile = {
  path: 'lib/chat_screen.dart',
  language: 'dart',
  code: `import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:raven_chat/raven_chat.dart';

const backendUrl = String.fromEnvironment(
  'RAVEN_BACKEND_URL',
  defaultValue: 'http://localhost:3000',
);

class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key, required this.userId, required this.conversation});

  final String userId;
  final String conversation;

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  RavenChat? _chat;
  final _messages = <RavenMessage>[];
  final _composer = TextEditingController();

  @override
  void initState() {
    super.initState();
    unawaited(_connect());
  }

  @override
  void dispose() {
    _composer.dispose();
    _chat?.dispose();
    super.dispose();
  }

  Future<void> _connect() async {
    final response = await http.post(
      Uri.parse('\$backendUrl/api/chat-token'),
      headers: {'content-type': 'application/json'},
      body: jsonEncode({'userId': widget.userId, 'conversation': widget.conversation}),
    );
    final grant = jsonDecode(response.body) as Map<String, dynamic>;

    final chat = RavenChat(token: grant['token'] as String, apiUrl: grant['apiUrl'] as String);
    await chat.connect(widget.conversation);

    chat.messages.listen((message) {
      if (!mounted) return;
      setState(() => _messages.add(message));
    });

    if (!mounted) {
      chat.dispose();
      return;
    }
    setState(() => _chat = chat);
  }

  Future<void> _send() async {
    final text = _composer.text.trim();
    final chat = _chat;
    if (text.isEmpty || chat == null) return;
    _composer.clear();
    // Completes once Livqeno has durably stored it; the message itself
    // arrives back through the messages stream above.
    await chat.send(text);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        body: Column(
          children: [
            Expanded(
              child: ListView.builder(
                itemCount: _messages.length,
                itemBuilder: (context, index) => ListTile(
                  title: Text(_messages[index].senderId),
                  subtitle: Text(_messages[index].text ?? ''),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(8),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _composer,
                      onSubmitted: (_) => unawaited(_send()),
                    ),
                  ),
                  IconButton(icon: const Icon(Icons.send), onPressed: () => unawaited(_send())),
                ],
              ),
            ),
          ],
        ),
      );
}`,
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
      {
        ...CHAT_NEXTJS_ROUTE,
        path: 'server/routes/chat-token.ts',
        code: CHAT_NEXTJS_ROUTE.code.replace('@/lib/raven-chat', '../raven-chat'),
      },
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
  {
    product: 'chat',
    framework: 'flutter',
    supported: true,
    packages: { server: '@ravenkash/server', client: 'raven_chat' },
    install: flutterInstallCommand(['raven_chat']),
    env: { client: [], server: SERVER_ENV },
    files: [CHAT_SERVER_FILE('server.js'), CHAT_FLUTTER_CLIENT],
    runCommand:
      'flutter run --dart-define=RAVEN_BACKEND_URL=http://<your-lan-ip>:3000   # backend runs separately, e.g. node server.js',
    checks: CHAT_CHECKS,
    source:
      'sdks/flutter/raven_chat/lib/src/chat_client.dart (RavenChat, connect, send, messages) + examples/flutter-rtc-chat/lib/main.dart',
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

// Verified against the real sdks/flutter/raven_live and raven_rtc: this is
// the same shape flutter_check/live_host runs in
// apps/api/test/flutter-live-streaming.e2e-spec.ts (a real end-to-end check
// — real backend, real SFU, real browser subscriber observing real frames).
// RavenLiveStream.join(credentials), .isHost, .room (an ordinary RavenRoom
// — enableCamera/enableMicrophone are the same raven_rtc methods used in the
// RTC recipe above), .leave(). RavenVideoView isn't re-exported by
// raven_live (see lib/raven_live.dart's own comment on this), so rendering
// video needs a direct `package:raven_rtc/raven_rtc.dart` import and
// raven_rtc as a direct dependency, not merely a transitive one.
const LIVE_FLUTTER_CLIENT: CodeFile = {
  path: 'lib/live_stream_screen.dart',
  language: 'dart',
  code: `import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:raven_live/raven_live.dart';
import 'package:raven_rtc/raven_rtc.dart'; // RavenVideoView — not re-exported by raven_live

const backendUrl = String.fromEnvironment(
  'RAVEN_BACKEND_URL',
  defaultValue: 'http://localhost:3000',
);

class LiveStreamScreen extends StatefulWidget {
  const LiveStreamScreen({super.key, required this.title, required this.identity, required this.asHost});

  final String title;
  final String identity;
  final bool asHost;

  @override
  State<LiveStreamScreen> createState() => _LiveStreamScreenState();
}

class _LiveStreamScreenState extends State<LiveStreamScreen> {
  RavenLiveStream? _stream;

  @override
  void initState() {
    super.initState();
    unawaited(_join());
  }

  @override
  void dispose() {
    final stream = _stream;
    if (stream != null) unawaited(stream.leave());
    super.dispose();
  }

  Future<void> _join() async {
    // credentials come from your backend's /api/live/host (host) or
    // /api/live/viewer (viewer) below — never minted on the device.
    final route = widget.asHost ? '/api/live/host' : '/api/live/viewer';
    final response = await http.post(
      Uri.parse('\$backendUrl\$route'),
      headers: {'content-type': 'application/json'},
      body: jsonEncode(
        widget.asHost
            ? {'title': widget.title, 'hostIdentity': widget.identity}
            : {'streamId': widget.title, 'identity': widget.identity},
      ),
    );
    final credentials = RavenLiveStreamCredentials.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );

    // join() reaches the underlying RTC room internally — there is no
    // separate room-join step for a live stream.
    final stream = await RavenLiveStream.join(credentials);

    if (stream.isHost) {
      await stream.room.enableCamera();
      await stream.room.enableMicrophone();
    }

    if (!mounted) {
      // The screen went away while connecting.
      await stream.leave();
      return;
    }
    setState(() => _stream = stream);
  }

  @override
  Widget build(BuildContext context) {
    final stream = _stream;
    if (stream == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    // RavenRoom is a ChangeNotifier; ListenableBuilder rebuilds this
    // subtree as participants and tracks change.
    return ListenableBuilder(
      listenable: stream.room,
      builder: (context, _) {
        final room = stream.room;
        final remotes = room.remoteParticipants;
        final featured = remotes.isEmpty ? null : remotes.first;

        return Scaffold(
          body: Stack(
            children: [
              Positioned.fill(
                child: RavenVideoView(participant: featured, room: room),
              ),
              if (stream.isHost)
                Positioned(
                  right: 16,
                  top: 16,
                  width: 96,
                  height: 140,
                  child: RavenVideoView(participant: room.localParticipant, room: room),
                ),
              Positioned(
                left: 16,
                bottom: 16,
                child: FloatingActionButton(
                  onPressed: () => Navigator.of(context).maybePop(),
                  child: const Icon(Icons.call_end),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

// Leaving (above) releases this device's own connection. Ending the
// stream itself (LIVE -> ENDED, for every participant) is a separate,
// server-side call — see your backend's raven.liveStreams.end(streamId).`,
};

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
    source:
      'packages/server-sdk/src/resources/live-streams.ts + packages/client/src/live/live-stream.ts (LiveStream.join)',
  },
  {
    product: 'live-streaming',
    framework: 'react',
    supported: true,
    packages: { server: '@ravenkash/server', client: '@ravenkash/client' },
    install: installCommands(['@ravenkash/client']),
    env: { client: [], server: SERVER_ENV },
    files: [{ ...LIVE_SERVER_FILE('server/raven-live.ts') }, LIVE_CLIENT('src/live.ts')],
    runCommand: 'npm run dev   # Vite dev server — run your Node backend separately',
    checks: LIVE_CHECKS,
    source:
      'packages/client/src/live/live-stream.ts — no dedicated React hook exists yet, so this uses the same real client class directly',
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
  {
    product: 'live-streaming',
    framework: 'flutter',
    supported: true,
    // raven_rtc alongside raven_live: RavenVideoView (used below to render
    // remote/local video) isn't re-exported by raven_live — see that
    // package's lib/raven_live.dart — so rendering anything needs raven_rtc
    // as a direct dependency, not merely the one raven_live pulls in
    // transitively.
    packages: { server: '@ravenkash/server', client: 'raven_live raven_rtc' },
    install: flutterInstallCommand(['raven_live', 'raven_rtc']),
    env: { client: [], server: SERVER_ENV },
    files: [LIVE_SERVER_FILE('server.js'), LIVE_FLUTTER_CLIENT],
    runCommand:
      'flutter run --dart-define=RAVEN_BACKEND_URL=http://<your-lan-ip>:3000   # backend runs separately, e.g. node server.js',
    checks: LIVE_CHECKS,
    source:
      'sdks/flutter/raven_live/lib/src/live_stream.dart (RavenLiveStream.join/.isHost/.room/.leave) + ' +
      'sdks/flutter/raven_rtc/lib/src/video_view.dart (RavenVideoView). Verified end to end on Flutter ' +
      'Web — real camera/mic publish through a real SFU, a real browser observing real frame growth — via ' +
      'flutter_check/live_host and apps/api/test/flutter-live-streaming.e2e-spec.ts. Android/iOS: see PLATFORM_STATUS above.',
  },
];

const ALL_ENTRIES: IntegrationEntry[] = [...RTC_ENTRIES, ...CHAT_ENTRIES, ...LIVE_ENTRIES];

/**
 * Capability-based lookup (spec §12): a combination is "supported" exactly
 * when a real `IntegrationEntry` exists for it in `ALL_ENTRIES` — there is
 * no blanket "only TypeScript" gate. This is what lets Dart/Flutter (and
 * any future SDK) become available by adding entries, not by editing this
 * function's logic.
 *
 * Three distinct reasons a combination can come back unsupported, each
 * with an answer specific enough to act on rather than a single generic
 * "coming soon" (spec §13/§20):
 *   1. The language itself isn't supported at all (`LANGUAGES[].supported`).
 *   2. The framework doesn't exist, or belongs to a different language than
 *      the one requested (shouldn't happen through the wizard's own UI,
 *      which filters frameworks by language, but is still a real state a
 *      direct/stale call can reach).
 *   3. The language is supported and the framework is real, but this
 *      specific product has no recipe for it yet — e.g. if Dart later
 *      gained RTC and Chat but not Live Streaming, only Live Streaming
 *      would report unsupported, not the whole language.
 */
export function getIntegrationEntry(
  product: Product,
  language: Language | string,
  framework: Framework | string,
): IntegrationEntry | UnsupportedEntry {
  const languageMeta = LANGUAGES.find((l) => l.id === language);
  const frameworkMeta = FRAMEWORKS.find((f) => f.id === framework);

  if (!languageMeta || !languageMeta.supported) {
    return {
      product,
      framework: framework as Framework,
      supported: false,
      reason: `${languageMeta?.label ?? language} is not yet supported for integration examples.`,
      alternative:
        language === 'python'
          ? 'Python is supported for server-side use only (install via git — see the SDKs page). For the client half, pick TypeScript/JavaScript or Dart (Flutter) above.'
          : 'Pick TypeScript/JavaScript or Dart (Flutter) for a working integration today.',
    };
  }

  if (!frameworkMeta || frameworkMeta.language !== language) {
    const choices = FRAMEWORKS.filter((f) => f.language === language)
      .map((f) => f.label)
      .join(', ');
    return {
      product,
      framework: framework as Framework,
      supported: false,
      reason: `This combination isn't available yet.`,
      alternative: `Choose a ${languageMeta.label} framework: ${choices}.`,
    };
  }

  const entry = ALL_ENTRIES.find((e) => e.product === product && e.framework === framework);
  if (!entry) {
    const productLabel = PRODUCTS.find((p) => p.id === product)?.label ?? product;
    const availableProducts = [
      ...new Set(
        ALL_ENTRIES.filter((e) => FRAMEWORKS.find((f) => f.id === e.framework)?.language === language).map(
          (e) => PRODUCTS.find((p) => p.id === e.product)?.label ?? e.product,
        ),
      ),
    ];
    return {
      product,
      framework: framework as Framework,
      supported: false,
      reason: `${productLabel} isn't available yet for ${frameworkMeta.label}.`,
      alternative:
        availableProducts.length > 0
          ? `Available for ${frameworkMeta.label}: ${availableProducts.join(', ')}.`
          : `Nothing is available for ${frameworkMeta.label} yet.`,
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
  const frameworkMeta = FRAMEWORKS.find((f) => f.id === entry.framework);
  const frameworkLabel = frameworkMeta?.label ?? entry.framework;
  const languageLabel = LANGUAGES.find((l) => l.id === frameworkMeta?.language)?.label ?? '';

  const lines: string[] = [
    `# Raven Integration — ${project.name}`,
    ``,
    `${languageLabel} + ${frameworkLabel} + ${productLabel}`,
    ``,
    `## 1. Install`,
    ``,
    '```' + (entry.install[0]?.language ?? 'bash'),
    entry.install[0]?.code ?? '',
    '```',
    ...(entry.install.length > 1
      ? [``, `Other package managers: ${entry.install.map((cmd) => cmd.label).join(', ')}.`]
      : []),
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
