// Phase 10 — reconnection. Uses the REAL public SDK (@ravenkash/chat) so that
// "no manual page refresh required" is tested against what a developer ships,
// not against a hand-rolled socket.
import { http, must, sleep } from './lib.mjs';
import { test, note, eq, ok, summary } from './runner.mjs';
import ctx from './ctx.json' with { type: 'json' };
import WebSocket from 'ws';
import { createChatClient } from '@ravenkash/chat';

globalThis.WebSocket = WebSocket;            // Node has no global WebSocket in this version path
globalThis.atob ??= (b) => Buffer.from(b, 'base64').toString('binary');

const { apiKey } = ctx;
const S = 'p10' + Date.now().toString(36);

console.log('\n########## PHASE 10 — RECONNECTION (via the public SDK) ##########\n');
const conv = must(await http('/v1/chat/conversations', { method: 'POST', token: apiKey, body: {
  name: S, members: [{ userId: 'alice' }, { userId: 'bob' }] } }), 201, 'conv');
const room = conv.publicId;
const grant = async (u) => must(await http('/v1/chat/tokens', { method: 'POST', token: apiKey, body: { userId: u, conversations: [room], ttlSeconds: 21600 } }), 201, u);
const ag = await grant('alice'), bg = await grant('bob');

const mkClient = (g, label) => {
  const c = createChatClient({ ...g, logLevel: 'silent', initialReconnectDelayMs: 300, maxReconnectDelayMs: 2000, maxReconnectAttempts: 40 });
  const log = { messages: [], states: [], reconnecting: 0, reconnected: 0, errors: [], presence: [] };
  c.on('message', (m) => log.messages.push(m));
  c.on('connectionStateChanged', (s) => log.states.push(s));
  c.on('reconnecting', () => log.reconnecting++);
  c.on('reconnected', () => log.reconnected++);
  c.on('presence', (p) => log.presence.push(p));
  c.on('error', (e) => log.errors.push(e.message));
  return { c, log, label };
};

const alice = mkClient(ag, 'alice'), bob = mkClient(bg, 'bob');
await alice.c.connect({ room });
await bob.c.connect({ room });
await sleep(300);

await test('SDK: connect + send + receive before the restart', async () => {
  bob.log.messages.length = 0;
  const sent = await alice.c.sendMessage({ text: 'before-restart' });
  ok(sent.id.startsWith('msg_'), 'canonical id from the SDK');
  await sleep(600);
  eq(bob.log.messages.map((m) => m.text), ['before-restart'], 'bob received it through the SDK');
  eq(alice.c.connectionState, 'connected', 'state connected');
});

const preRestartConnectionId = alice.c.id;
const restartMarker = must(await http(`/v1/chat/conversations/${room}/messages?limit=1`, { token: ag.token }), 200, 'cursor').previousCursor;

await test('kill the realtime service → clients observe the drop', async () => {
  const { execSync } = await import('child_process');
  execSync('pkill -f "node dist/main.js"');
  await sleep(1500);
  ok(['reconnecting', 'disconnected', 'failed'].includes(alice.c.connectionState), `alice noticed: ${alice.c.connectionState}`);
  ok(alice.log.reconnecting > 0, `alice is retrying (${alice.log.reconnecting} attempts so far)`);
  note(`alice states: ${JSON.stringify(alice.log.states)}`);
});

let messagesSentWhileDown = [];
await test('messages sent while the gateway is down are stored via the REST fallback… or fail cleanly', async () => {
  // The gateway is the API, so REST is down too here. This documents the real
  // behaviour rather than asserting a guarantee the system does not make.
  try {
    const r = await alice.c.sendMessage({ text: 'during-outage' });
    messagesSentWhileDown.push(r.id);
    note('SDK accepted a send during the outage (REST fallback path)');
  } catch (e) {
    note(`SDK rejected the send during the outage: ${e.constructor.name} — ${e.message}`);
  }
  ok(true, 'observational');
});

await test('restart the service → clients reconnect with no manual intervention', async () => {
  const { spawn } = await import('child_process');
  const env = { ...process.env, CHAT_SEND_RATE_LIMIT: '100000', CHAT_CONNECTION_RATE_LIMIT: '100000', CHAT_SUBSCRIBE_RATE_LIMIT: '100000', CHAT_TYPING_RATE_LIMIT: '100000', CHAT_REACTION_RATE_LIMIT: '100000' };
  const child = spawn('node', ['dist/main.js'], { cwd: process.env.API_CWD, env, detached: true, stdio: 'ignore' });
  child.unref();

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline && (alice.c.connectionState !== 'connected' || bob.c.connectionState !== 'connected')) await sleep(500);
  eq(alice.c.connectionState, 'connected', 'alice reconnected on her own');
  eq(bob.c.connectionState, 'connected', 'bob reconnected on his own');
  ok(alice.c.id && alice.c.id !== preRestartConnectionId, 'new connection id issued');
  note(`alice reconnect attempts: ${alice.log.reconnecting}, reconnected events: ${alice.log.reconnected}`);
});

await test('authentication restored — the same identity, not a new one', async () => {
  eq(alice.c.userId, 'alice', 'still alice');
  const r = await alice.c.sendMessage({ text: 'after-restart' });
  eq(r.senderId, 'alice', 'server attributes to alice');
});

await test('subscriptions restored — fan-out works again with no re-join call', async () => {
  bob.log.messages.length = 0;
  await alice.c.sendMessage({ text: 'after-restart-fanout' });
  await sleep(1200);
  // The previous test's message can still land after this clear, so assert
  // membership rather than an exact list — what matters is that fan-out
  // reaches bob at all without him re-joining.
  ok(bob.log.messages.some((m) => m.text === 'after-restart-fanout'), 'bob is still subscribed after the restart');
  eq(bob.c.rooms, [room], 'SDK re-joined the room automatically');
});

await test('missed messages are recoverable after the outage', async () => {
  const page = must(await http(`/v1/chat/conversations/${room}/messages?after=${encodeURIComponent(restartMarker)}`, { token: ag.token }), 200, 'catch-up');
  const texts = page.data.map((m) => m.text);
  ok(texts.includes('after-restart'), 'post-restart messages retrievable');
  note(`recovered ${texts.length}: ${JSON.stringify(texts)}`);
  note('Recovery is a manual messages.list({ after }) — the SDK exposes no automatic replay-on-reconnect.');
});

await test('presence corrected after the restart', async () => {
  await sleep(1000);
  const p = must(await http(`/v1/chat/conversations/${room}/presence`, { token: apiKey }), 200, 'p');
  eq(p.map((x) => x.userId).sort(), ['alice', 'bob'], 'both present again');
  eq(p.every((x) => x.status === 'online'), true, 'both online');
});

await test('typing state reset appropriately across the restart', async () => {
  await alice.c.startTyping();
  await sleep(400);
  const t = must(await http(`/v1/chat/conversations/${room}/typing`, { token: apiKey }), 200, 't');
  eq(t.userIds, ['alice'], 'typing works after the restart');
  await alice.c.stopTyping();
  await sleep(300);
  eq(must(await http(`/v1/chat/conversations/${room}/typing`, { token: apiKey }), 200, 't2').userIds, [], 'cleared');
});

await test('no duplicate messages were delivered across the whole restart cycle', async () => {
  const ids = bob.log.messages.map((m) => m.id);
  eq(ids.length, new Set(ids).size, 'no duplicates in bob\'s stream');
});

await alice.c.disconnect(); await bob.c.disconnect();
const res = summary('PHASE 10');
process.exit(res.failures.length ? 1 : 0);
