'use client';

import { useState } from 'react';

/**
 * Every snippet here is the real, current API — copied from docs/sdk.md,
 * docs/chat/overview.md, and docs/sdk/server/python.md, not invented for
 * effect. If one of these stops compiling against the actual SDK, the
 * docs it was copied from are wrong too — fix both together.
 */
const SAMPLES = [
  {
    id: 'rtc',
    label: 'Video calling',
    filename: 'client.js',
    code: `import { createRTCClient } from '@raven/rtc';

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
    code: `import { createChatClient } from '@raven/chat';

const chat = createChatClient({ token: resp.token });

await chat.connect({ room: conversation.publicId });
await chat.sendMessage({ text: 'Hello everyone!' });

chat.on('message', (msg) => console.log(msg.senderId, msg.text));`,
  },
  {
    id: 'server',
    label: 'Server (Python)',
    filename: 'server.py',
    code: `from raven import Raven, CreateTokenParams, TokenPermissions

raven = Raven(api_key=os.environ["RAVEN_API_KEY"])

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

export function CodeSample() {
  const [active, setActive] = useState<(typeof SAMPLES)[number]['id']>('rtc');
  const sample = SAMPLES.find((s) => s.id === active)!;

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-raven-lg">
      <div className="flex items-center gap-1 border-b border-line bg-surface-sunken px-2 pt-2">
        {SAMPLES.map((s) => (
          <button
            key={s.id}
            onClick={() => setActive(s.id)}
            className={`rounded-t-md px-3.5 py-2 text-sm font-medium transition-colors ${
              s.id === active
                ? 'bg-surface text-fg border-x border-t border-line -mb-px'
                : 'text-muted hover:text-fg'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5 border-b border-line px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-danger/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-warning/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-success/60" />
        <span className="ml-2 font-mono text-xs text-subtle">{sample.filename}</span>
      </div>
      <pre className="overflow-x-auto p-5 text-[13px] leading-relaxed">
        <code className="font-mono text-fg">{sample.code}</code>
      </pre>
    </div>
  );
}
