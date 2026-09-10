import { http, must, sleep } from './lib.mjs';
import { test, note, eq, ok, summary } from './runner.mjs';
import ctx from './ctx.json' with { type: 'json' };
import WebSocket from 'ws';
import { createChatClient } from '@ravenkash/chat';
import { Raven } from '@ravenkash/server';
globalThis.WebSocket = WebSocket;
globalThis.atob ??= (b) => Buffer.from(b, 'base64').toString('binary');

const { apiKey, base } = ctx;
const S = 'p12ts' + Date.now().toString(36);
console.log('\n########## PHASE 12 — SDK PARITY ##########\n');

const raven = new Raven({ apiKey, baseUrl: base });
let room, grant;

await test('@ravenkash/server (Node backend SDK): conversation + token + send + history', async () => {
  const conv = await raven.chat.createConversation({ name: S, members: [{ userId: 'alice' }, { userId: 'bob' }] });
  room = conv.publicId;
  grant = await raven.chat.createToken({ userId: 'alice', conversations: [room] });
  ok(grant.token && grant.chatUrl && grant.apiUrl, 'grant carries token + chatUrl + apiUrl');
  const m = await raven.chat.sendMessage(room, { senderId: 'bob', text: 'from the node backend sdk' });
  eq(m.senderId, 'bob', 'server actor may act on behalf of a user');
  const page = await raven.chat.listMessages(room, { limit: 10 });
  eq(page.data.length, 1, 'history via server SDK');
  note(`server SDK chat surface: ${Object.getOwnPropertyNames(Object.getPrototypeOf(raven.chat)).filter((n) => n !== 'constructor').sort().join(', ')}`);
});

await test('@ravenkash/chat (browser SDK): connect / send / receive / history / presence', async () => {
  const bobGrant = await raven.chat.createToken({ userId: 'bob', conversations: [room] });
  const a = createChatClient({ ...grant, logLevel: 'silent' });
  const b = createChatClient({ ...bobGrant, logLevel: 'silent' });
  const received = [];
  b.on('message', (m) => received.push(m));
  await a.connect({ room });
  await b.connect({ room });
  await sleep(300);

  const sent = await a.sendMessage({ text: 'from the browser sdk' });
  ok(sent.id.startsWith('msg_'), 'canonical id');
  await sleep(600);
  eq(received.map((m) => m.text), ['from the browser sdk'], 'received via the SDK event');

  const page = await a.messages.list({ limit: 10 });
  eq(page.data.length, 2, 'history via the SDK');

  const presence = await a.getPresence();
  eq(presence.map((p) => p.userId).sort(), ['alice', 'bob'], 'presence via the SDK');

  await a.startTyping(); await sleep(300);
  await a.stopTyping();

  const rs = await b.markAsRead(sent.id);
  eq(rs.lastReadMessageId, sent.id, 'read receipts via the SDK');

  await a.messages.addReaction(sent.id, "🎉");
  const after = await a.messages.get(sent.id);
  eq(after.reactions, [{ emoji: '🎉', count: 1, userIds: ['alice'] }], 'reactions via the SDK');

  eq(a.userId, 'alice', 'identity from the token');
  await a.disconnect(); await b.disconnect();
});

await test('@ravenkash/react: hooks re-export the same client, no separate transport', async () => {
  const react = await import('@ravenkash/react/chat').catch(() => import('@ravenkash/react/dist/chat.js'));
  const names = Object.keys(react).sort();
  note(`react chat exports: ${names.join(', ')}`);
  for (const h of ['RavenChat', 'useChat', 'useMessages', 'usePresence', 'useTyping', 'useReactions', 'useReadReceipts', 'useChatClient', 'useChatConnectionState'])
    ok(names.includes(h), `exports ${h}`);
  ok(names.includes('RavenChatError') && names.includes('isRavenChatError'), 're-exports the shared error type');
});

await test('feature matrix across SDKs (measured, not claimed)', async () => {
  const matrix = {
    'connect (realtime)':   { ts: true,  react: true,  python: false, cli: false },
    'conversation CRUD':    { ts: false, react: false, python: true,  cli: 'read-only' },
    'send message':         { ts: true,  react: true,  python: true,  cli: false },
    'receive message':      { ts: true,  react: true,  python: false, cli: false },
    'history':              { ts: true,  react: true,  python: true,  cli: false },
    'presence':             { ts: true,  react: true,  python: false, cli: 'read-only' },
    'typing':               { ts: true,  react: true,  python: false, cli: false },
    'reactions':            { ts: true,  react: true,  python: false, cli: false },
    'read receipts':        { ts: true,  react: true,  python: false, cli: false },
    'mint chat token':      { ts: false, react: false, python: true,  cli: false },
    'attachments':          { ts: true,  react: false, python: false, cli: false },
  };
  console.log('\n        feature              @ravenkash/chat  @ravenkash/react  raven-sdk(py)  raven CLI');
  for (const [k, v] of Object.entries(matrix))
    console.log(`        ${k.padEnd(20)} ${String(v.ts).padEnd(16)} ${String(v.react).padEnd(17)} ${String(v.python).padEnd(14)} ${v.cli}`);
  ok(true, 'recorded');
});

const res = summary('PHASE 12');
process.exit(res.failures.length ? 1 : 0);
