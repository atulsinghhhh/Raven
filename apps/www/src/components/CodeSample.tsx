'use client';

import { useState } from 'react';
import { ChatDemo, EffectsDemo, LiveDemo, RoomDemo, TokenDemo } from './ProductDemos';

/**
 * Every snippet here is the real, current API: copied from
 * docs/rtc/quickstart.md, docs/chat/quickstart.md,
 * docs/live-streaming/quickstart.md, docs/effects/quickstart.md, and
 * docs/sdk/server/python.md, not invented for effect. If one of these
 * stops compiling against the actual SDK, the docs it was copied from
 * are wrong too: fix both together.
 */
const SAMPLES = [
  {
    id: 'rtc',
    label: 'RTC',
    filename: 'client.js',
    code: `import { createRTCClient } from '@ravenkash/rtc';

const client = createRTCClient({
  token: resp.token,
  endpoint: resp.endpoint,
  iceServers: resp.iceServers,
});

const room = await client.join('room-123');
await room.enableCamera();
await room.enableMicrophone();`,
  },
  {
    id: 'chat',
    label: 'Chat',
    filename: 'chat.js',
    code: `import { createChatClient } from '@ravenkash/chat';

const chat = createChatClient({ token: resp.token });

await chat.connect({ room: conversation.publicId });
await chat.sendMessage({ text: 'Hello everyone!' });

chat.on('message', (msg) => console.log(msg.senderId, msg.text));`,
  },
  {
    id: 'live',
    label: 'Live streaming',
    filename: 'live.js',
    code: `import { LiveStream } from '@ravenkash/client';

const stream = await LiveStream.join({
  streamId,
  role: 'HOST',
  rtc: credentials.rtc,
  chat: credentials.chat,
});

await stream.room.enableCamera();
await stream.room.enableMicrophone();

// A Livqeno Chat conversation comes attached automatically.
await stream.chat.sendMessage({ text: 'We\\'re live!' });`,
  },
  {
    id: 'effects',
    label: 'Effects',
    filename: 'effects.js',
    code: `import { effects } from '@ravenkash/effects';

const pipeline = effects.createPipeline();
pipeline.add(effects.filters.brightness({ value: 0.2 }));
pipeline.add(effects.filters.saturation({ value: 1.2 }));

const camera = await room.enableCamera();
await camera.attachEffects(pipeline);`,
  },
  {
    id: 'server',
    label: 'Server (Python)',
    filename: 'server.py',
    code: `from raven import Livqeno, CreateTokenParams, TokenPermissions

raven = Raven(
    api_key=os.environ["RAVEN_API_KEY"],
    base_url=os.environ["RAVEN_API_URL"],  # https://api.ravenstack.online
)

token = raven.tokens.create(
    CreateTokenParams(
        room=room_id,
        identity="user-42",
        permissions=TokenPermissions(join=True, publish=True, subscribe=True),
        expires_in=3600,
    )
)
# hand \`token\` to your frontend — never mint one in the browser`,
  },
] as const;

/**
 * Which demo panel stands beside each snippet. The pairing is the point
 * of the split view: the left half is the call you write, the right
 * half is the thing that call produces.
 */
const PREVIEWS: Record<(typeof SAMPLES)[number]['id'], React.ReactNode> = {
  rtc: <RoomDemo />,
  chat: <ChatDemo />,
  live: <LiveDemo />,
  effects: <EffectsDemo />,
  server: <TokenDemo />,
};

export function CodeSample() {
  const [active, setActive] = useState<(typeof SAMPLES)[number]['id']>('rtc');
  const sample = SAMPLES.find((s) => s.id === active)!;

  return (
    <div className="overflow-hidden rounded-2xl bg-surface card-lift">
      {/* File tabs read as ordinary sans filenames rather than mono
          product labels — this is an editor chrome, not a nav. */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-line bg-surface-sunken px-1.5 py-1.5 text-[12px]">
        {SAMPLES.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setActive(s.id)}
            className={`shrink-0 rounded-(--radius-panel) px-3 py-1.5 font-mono transition-colors ${
              s.id === active ? 'bg-surface text-fg' : 'text-muted hover:text-fg'
            }`}
          >
            {s.filename}
          </button>
        ))}
      </div>

      <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
        <pre className="overflow-x-auto p-6 text-[13px] leading-relaxed">
          <code className="font-mono text-fg">{sample.code}</code>
        </pre>

        <div className="border-line p-4 md:border-l">
          <span className="mono-label mb-3 flex items-center gap-1.5 text-[10px] text-muted">
            <EyeIcon />
            Preview
          </span>
          {/* Keyed so switching files remounts the demo and replays its
              entrance, instead of swapping content into a settled panel. */}
          <div key={sample.id}>{PREVIEWS[sample.id]}</div>
        </div>
      </div>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" strokeLinejoin="round" />
      <circle cx="8" cy="8" r="1.75" />
    </svg>
  );
}
