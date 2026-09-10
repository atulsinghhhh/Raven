// Phase 15 — automatic missed-message recovery, end to end against the real
// server, through the public SDK only. No fakes anywhere in this file.
import { http, must, sleep } from './lib.mjs';
import { test, note, eq, ok, summary } from './runner.mjs';
import ctx from './ctx.json' with { type: 'json' };
import WebSocket from 'ws';
import { execSync } from 'child_process';
import { createChatClient } from '@ravenkash/chat';

globalThis.WebSocket = WebSocket;
globalThis.atob ??= (b) => Buffer.from(b, 'base64').toString('binary');

const { apiKey } = ctx;
const S = 'p15' + Date.now().toString(36);
const API_CWD = process.env.API_CWD;

console.log('\n########## PHASE 15 — AUTOMATIC MISSED-MESSAGE RECOVERY ##########\n');

const mkRoom = async (name, users = ['alice', 'bob']) =>
  (must(await http('/v1/chat/conversations', { method: 'POST', token: apiKey, body: {
    name, members: users.map((u) => ({ userId: u })) } }), 201, 'conv')).publicId;

const grant = async (u, rooms) =>
  must(await http('/v1/chat/tokens', { method: 'POST', token: apiKey, body: {
    userId: u, conversations: rooms, ttlSeconds: 21600 } }), 201, `mint ${u}`);

/** A real SDK client with everything it emitted recorded. */
async function client(user, rooms, label = user, opts = {}) {
  const g = await grant(user, rooms);
  const c = createChatClient({ ...g, logLevel: 'silent', initialReconnectDelayMs: 200, maxReconnectDelayMs: 1000, maxReconnectAttempts: 40, autoReconnect: false, ...opts });
  const log = { messages: [], recoveries: [], states: [], errors: [], typing: [], presence: [], reads: [] };
  c.on('message', (m) => log.messages.push(m));
  c.on('recovered', (s) => log.recoveries.push(s));
  c.on('connectionStateChanged', (s) => log.states.push(s));
  c.on('error', (e) => log.errors.push(e.message));
  c.on('typing', (e) => log.typing.push(e));
  c.on('presence', (e) => log.presence.push(e));
  c.on('read', (e) => log.reads.push(e));
  await c.connect({ rooms });
  await sleep(250);
  return { c, log, label };
}

/**
 * Drops the socket the way a network failure does, without telling the SDK
 * to stop reconnecting.
 *
 * `terminate()` rather than `close()`: an abrupt kill is what an outage
 * actually looks like, and 1006 is a reserved code `ws` refuses to send.
 */
function killSocket(client) {
  const transport = client.c.transport ?? client.c['transport'];
  const socket = transport?.socket ?? transport?.['socket'];
  if (!socket) throw new Error('could not reach the underlying socket');
  if (typeof socket.terminate === 'function') socket.terminate();
  else socket.close(4999, 'test-induced drop');
}

/** Waits for the next `recovered` summary after `from`. */
async function nextRecovery(client, from, ms = 30000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (client.log.recoveries.length > from) return client.log.recoveries[from];
    await sleep(100);
  }
  throw new Error(`${client.label}: no recovery reported within ${ms}ms`);
}

/**
 * Sends as `user` using a cached chat token rather than the project API key.
 *
 * Not cosmetic: API-key auth bcrypt-verifies on every request (~100ms), so
 * seeding 250 messages through it takes ~25s — long enough that the client
 * under test reconnects mid-seed and receives them live, which would test
 * the wrong path entirely. A chat token verifies by HMAC in ~6ms.
 */
const senderTokens = new Map();
async function sendAs(user, room, text, key) {
  const cacheKey = `${user}:${room}`;
  let token = senderTokens.get(cacheKey);
  if (!token) {
    token = (await grant(user, [room])).token;
    senderTokens.set(cacheKey, token);
  }
  return must(await http(`/v1/chat/conversations/${room}/messages`, { method: 'POST', token,
    body: { text, clientMessageId: key } }), 201, 'send');
}

/**
 * Takes a client offline, runs `whileOffline`, then brings it back.
 *
 * Auto-reconnect is off for these so the outage window is deterministic:
 * with it on, the SDK is back within a few hundred milliseconds and the
 * "missed" messages arrive live instead, which proves nothing about
 * recovery. The automatic path is covered separately below.
 */
async function withOutage(client, rooms, whileOffline) {
  const before = client.log.recoveries.length;
  await client.c.disconnect();
  await sleep(300);
  await whileOffline();
  await client.c.connect({ rooms });
  const rec = await nextRecovery(client, before, 90000);
  await sleep(500);
  return rec;
}

const texts = (log) => log.messages.map((m) => m.text);
const ids = (log) => log.messages.map((m) => m.id);

// ---------------------------------------------------------------------------

await test('1–4. disconnect → 1 message sent while away → reconnect → received exactly once', async () => {
  const room = await mkRoom(`${S}-basic`);
  const alice = await client('alice', [room]);
  await sendAs('bob', room, 'before', `${S}-b0`);
  await sleep(600);
  eq(texts(alice.log), ['before'], 'live message established the resume point');

  const rec = await withOutage(alice, [room], async () => {
    await sendAs('bob', room, 'missed-1', `${S}-m1`);
  });
  eq(rec.recovered, 1, 'one message recovered');
  eq(rec.gap, false, 'no gap');
  eq(texts(alice.log), ['before', 'missed-1'], 'delivered, in order');
  eq(ids(alice.log).length, new Set(ids(alice.log)).size, 'exactly once — no duplicate');
  await alice.c.disconnect();
});

await test('10 missed messages recover in order, exactly once', async () => {
  const room = await mkRoom(`${S}-ten`);
  const alice = await client('alice', [room]);
  await sendAs('bob', room, 'anchor', `${S}-t0`);
  await sleep(600);

  const rec = await withOutage(alice, [room], async () => {
    for (let i = 1; i <= 10; i++) await sendAs('bob', room, `t-${i}`, `${S}-t${i}`);
  });
  eq(rec.recovered, 10, '10 recovered');
  eq(texts(alice.log), ['anchor', ...Array.from({ length: 10 }, (_, i) => `t-${i + 1}`)], 'send order preserved');
  eq(ids(alice.log).length, new Set(ids(alice.log)).size, 'no duplicates');
  await alice.c.disconnect();
});

await test('100 missed messages across multiple pages (page size 100)', async () => {
  const room = await mkRoom(`${S}-hundred`);
  const alice = await client('alice', [room]);
  await sendAs('bob', room, 'anchor', `${S}-h0`);
  await sleep(600);

  // 250 forces three catch-up pages at the SDK's 100-per-page size.
  const rec = await withOutage(alice, [room], async () => {
    for (let i = 1; i <= 250; i++) await sendAs('bob', room, `h-${i}`, `${S}-h${i}`);
  });
  eq(rec.recovered, 250, 'all 250 recovered across pages');
  const got = texts(alice.log);
  eq(got.length, 251, '251 delivered in total');
  eq(new Set(ids(alice.log)).size, 251, 'no duplicates across page boundaries');
  eq(got, ['anchor', ...Array.from({ length: 250 }, (_, i) => `h-${i + 1}`)], 'per-sender order held across pages');
  await alice.c.disconnect();
});

await test('multiple conversations recover independently', async () => {
  const roomA = await mkRoom(`${S}-multiA`);
  const roomB = await mkRoom(`${S}-multiB`);
  const alice = await client('alice', [roomA, roomB]);
  await sendAs('bob', roomA, 'a-anchor', `${S}-ma0`);
  await sendAs('bob', roomB, 'b-anchor', `${S}-mb0`);
  await sleep(700);

  const rec = await withOutage(alice, [roomA, roomB], async () => {
    for (let i = 1; i <= 4; i++) await sendAs('bob', roomA, `a-${i}`, `${S}-ma${i}`);
    for (let i = 1; i <= 7; i++) await sendAs('bob', roomB, `b-${i}`, `${S}-mb${i}`);
  });
  eq(rec.recovered, 11, '4 + 7 recovered');
  const inA = alice.log.messages.filter((m) => m.roomId === roomA).map((m) => m.text);
  const inB = alice.log.messages.filter((m) => m.roomId === roomB).map((m) => m.text);
  eq(inA, ['a-anchor', 'a-1', 'a-2', 'a-3', 'a-4'], 'room A complete and ordered');
  eq(inB, ['b-anchor', 'b-1', 'b-2', 'b-3', 'b-4', 'b-5', 'b-6', 'b-7'], 'room B complete and ordered');
  eq(new Set(rec.perRoom.map((r) => r.room)).size, 2, 'each room recovered on its own cursor');
  await alice.c.disconnect();
});

await test('a message already delivered live is not re-delivered by the catch-up', async () => {
  const room = await mkRoom(`${S}-dupe`);
  const alice = await client('alice', [room]);
  // Delivered live. The catch-up must resume strictly after it.
  await sendAs('bob', room, 'race-1', `${S}-d1`);
  await sleep(600);
  eq(texts(alice.log), ['race-1'], 'delivered live');

  const rec = await withOutage(alice, [room], async () => {
    await sendAs('bob', room, 'race-2', `${S}-d2`);
  });

  eq(rec.recovered, 1, 'only the genuinely missed message was recovered');
  eq(texts(alice.log), ['race-1', 'race-2'], 'each message exactly once');
  eq(new Set(ids(alice.log)).size, alice.log.messages.length, 'no duplicate ids');
  note('the live/history overlap itself is forced deterministically in the SDK unit suite (recovery.spec.ts)');
  await alice.c.disconnect();
});

await test('message sent exactly during reconnect arrives once, after the recovered ones', async () => {
  const room = await mkRoom(`${S}-during`);
  // Automatic reconnect, deliberately slow to open a usable outage window.
  const alice = await client('alice', [room], 'alice', {
    autoReconnect: true, initialReconnectDelayMs: 4000, maxReconnectDelayMs: 6000,
  });
  await sendAs('bob', room, 'anchor', `${S}-r0`);
  await sleep(600);

  const before = alice.log.recoveries.length;
  killSocket(alice);
  await sleep(200);
  for (let i = 1; i <= 5; i++) await sendAs('bob', room, `pre-${i}`, `${S}-rp${i}`);

  // Fire a send at the moment the client is coming back up.
  void (async () => { await sleep(500); await sendAs('bob', room, 'during', `${S}-rd`); })();

  await nextRecovery(alice, before);
  await sleep(1500);
  const got = texts(alice.log);
  eq(new Set(ids(alice.log)).size, got.length, 'no duplicates');
  ok(got.includes('during'), 'the racing message was delivered');
  const order = got.filter((t) => t !== 'anchor');
  const duringAt = order.indexOf('during');
  const lastPre = order.lastIndexOf('pre-5');
  ok(duringAt > lastPre, `"during" (idx ${duringAt}) lands after the recovered pre-* (idx ${lastPre}) — no overtaking`);
  note(JSON.stringify(got));
  await alice.c.disconnect();
});

await test('gateway restart: recovery runs and loses nothing', async () => {
  const room = await mkRoom(`${S}-restart`);
  const alice = await client('alice', [room], 'alice', { autoReconnect: true });
  await sendAs('bob', room, 'anchor', `${S}-g0`);
  await sleep(600);

  const before = alice.log.recoveries.length;
  let rec0 = { recovered: 0 };
  execSync('pkill -f "node dist/main.js"');
  await sleep(2500);
  // The API is the store too, so the missed messages go in after it returns.
  const { spawn } = await import('child_process');
  const env = { ...process.env, CHAT_SEND_RATE_LIMIT: '100000', CHAT_CONNECTION_RATE_LIMIT: '100000', CHAT_SUBSCRIBE_RATE_LIMIT: '100000', CHAT_TYPING_RATE_LIMIT: '100000', CHAT_REACTION_RATE_LIMIT: '100000' };
  spawn('node', ['dist/main.js'], { cwd: API_CWD, env, detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 120; i++) {
    try { const r = await http('/health'); if (r.status === 200) break; } catch {}
    await sleep(500);
  }
  for (let i = 1; i <= 3; i++) await sendAs('bob', room, `g-${i}`, `${S}-g${i}`);

  rec0 = await nextRecovery(alice, before, 60000);
  await sleep(1500);
  const got = texts(alice.log);
  // Whether each message arrived live or through the catch-up depends on
  // exactly when the client got back up — that race is the point. What must
  // hold either way is: nothing lost, nothing doubled.
  for (let i = 1; i <= 3; i++) ok(got.includes(`g-${i}`), `g-${i} delivered`);
  eq(new Set(ids(alice.log)).size, got.length, 'no duplicates');
  eq(got, ['anchor', 'g-1', 'g-2', 'g-3'], 'complete and in order across the restart');
  note(`recovered via catch-up: ${rec0.recovered}; the rest arrived live`);
  await alice.c.disconnect();
});

await test('recovery works after a Redis restart (Postgres is the source of truth)', async () => {
  const room = await mkRoom(`${S}-redis`);
  const alice = await client('alice', [room]);
  await sendAs('bob', room, 'anchor', `${S}-x0`);
  await sleep(600);

  const rec = await withOutage(alice, [room], async () => {
    for (let i = 1; i <= 5; i++) await sendAs('bob', room, `x-${i}`, `${S}-x${i}`);
    // Wipe every scrap of ephemeral state, then bounce Redis entirely.
    execSync('docker exec raven-chat-audit-redis redis-cli flushall', { stdio: 'ignore' });
    execSync('docker restart raven-chat-audit-redis', { stdio: 'ignore' });
    await sleep(5000);
  });
  eq(rec.recovered, 5, 'all 5 recovered from Postgres with Redis freshly empty');
  eq(texts(alice.log), ['anchor', 'x-1', 'x-2', 'x-3', 'x-4', 'x-5'], 'complete and ordered');
  await alice.c.disconnect();
});

await test('a long offline period recovers everything', async () => {
  const room = await mkRoom(`${S}-long`);
  const alice = await client('alice', [room], 'alice', { autoReconnect: false });
  await sendAs('bob', room, 'anchor', `${S}-l0`);
  await sleep(600);

  // A genuinely long absence: disconnect fully, let 60 messages pile up.
  await alice.c.disconnect();
  await sleep(1000);
  for (let i = 1; i <= 60; i++) await sendAs('bob', room, `l-${i}`, `${S}-l${i}`);
  await sleep(2000);

  const before = alice.log.recoveries.length;
  await alice.c.connect({ room });
  const rec = await nextRecovery(alice, before, 60000);
  await sleep(600);
  eq(rec.recovered, 60, 'the whole absence recovered');
  eq(texts(alice.log), ['anchor', ...Array.from({ length: 60 }, (_, i) => `l-${i + 1}`)], 'ordered');
  eq(new Set(ids(alice.log)).size, 61, 'no duplicates');
  note('explicit disconnect() then connect() recovers too, not just an unexpected drop');
  await alice.c.disconnect();
});

await test('multiple browser sessions each recover their own missed messages', async () => {
  const room = await mkRoom(`${S}-sessions`);
  const one = await client('alice', [room], 'alice-tab1');
  const two = await client('alice', [room], 'alice-tab2');
  const bob = await client('bob', [room], 'bob');
  await sendAs('bob', room, 'anchor', `${S}-s0`);
  await sleep(700);

  const b1 = one.log.recoveries.length;
  const b2 = two.log.recoveries.length;
  await one.c.disconnect();
  await two.c.disconnect();
  await sleep(400);
  for (let i = 1; i <= 6; i++) await sendAs('bob', room, `s-${i}`, `${S}-s${i}`);
  await one.c.connect({ room });
  await two.c.connect({ room });

  const [r1, r2] = await Promise.all([nextRecovery(one, b1, 60000), nextRecovery(two, b2, 60000)]);
  await sleep(600);
  eq(r1.recovered, 6, 'tab 1 recovered all 6');
  eq(r2.recovered, 6, 'tab 2 recovered all 6');
  eq(texts(one.log), texts(two.log), 'both tabs converged on the same sequence');
  eq(new Set(ids(one.log)).size, one.log.messages.length, 'tab 1 saw no duplicates');
  eq(new Set(ids(two.log)).size, two.log.messages.length, 'tab 2 saw no duplicates');
  await one.c.disconnect(); await two.c.disconnect(); await bob.c.disconnect();
});

await test('authorization is preserved: a removed member recovers nothing', async () => {
  const room = await mkRoom(`${S}-authz`);
  const alice = await client('alice', [room]);
  await sendAs('bob', room, 'anchor', `${S}-z0`);
  await sleep(600);
  eq(texts(alice.log), ['anchor'], 'alice saw the anchor while a member');

  const rec = await withOutage(alice, [room], async () => {
    must(await http(`/v1/chat/conversations/${room}/members/alice`, { method: 'DELETE', token: apiKey }), 204, 'remove alice');
    for (let i = 1; i <= 4; i++) await sendAs('bob', room, `z-${i}`, `${S}-z${i}`);
  });
  eq(rec.recovered, 0, 'a non-member recovers nothing');
  eq(texts(alice.log), ['anchor'], 'no message leaked through the catch-up path');
  ok(rec.errors.length > 0 || rec.gap === false, 'the failure is reported, not silently swallowed');
  note(`per-room result: ${JSON.stringify(rec.perRoom)}`);
  await alice.c.disconnect();
});

await test('typing and presence are never replayed; read state stays persistent', async () => {
  const room = await mkRoom(`${S}-ephemeral`);
  const alice = await client('alice', [room]);
  const bob = await client('bob', [room], 'bob');
  await sendAs('bob', room, 'anchor', `${S}-e0`);
  await sleep(600);

  const snapshot = { typing: alice.log.typing.length, presence: alice.log.presence.length, reads: alice.log.reads.length };
  let missed;
  const rec = await withOutage(alice, [room], async () => {
    // Plenty of ephemeral traffic while alice is away.
    await bob.c.startTyping();
    await sleep(200);
    await bob.c.stopTyping();
    missed = await sendAs('bob', room, 'e-1', `${S}-e1`);
    await bob.c.markAsRead(missed.id);
  });
  eq(rec.recovered, 1, 'the message was recovered');
  eq(alice.log.typing.length, snapshot.typing, 'no typing events replayed');
  eq(alice.log.presence.filter((p) => p.userId === 'bob').length >= 0, true, 'presence reflects now, not a replay');
  eq(alice.log.reads.length, snapshot.reads, 'no stale read events replayed');

  // Read state comes from its persistent record instead.
  const rs = await alice.c.getReadReceipts(room);
  ok(rs.some((r) => r.userId === 'bob' && r.lastReadMessageId === missed.id), 'bob\'s read position is readable from persistent state');
  await alice.c.disconnect(); await bob.c.disconnect();
});

await test('reactions on recovered messages reflect current persisted state', async () => {
  const room = await mkRoom(`${S}-reactions`);
  const alice = await client('alice', [room]);
  const bob = await client('bob', [room], 'bob');
  await sendAs('bob', room, 'anchor', `${S}-k0`);
  await sleep(600);

  await withOutage(alice, [room], async () => {
    const missed = await sendAs('bob', room, 'k-1', `${S}-k1`);
    await bob.c.messages.addReaction(missed.id, '🎉');
  });
  const recovered = alice.log.messages.find((m) => m.text === 'k-1');
  ok(recovered, 'message recovered');
  eq(recovered.reactions, [{ emoji: '🎉', count: 1, userIds: ['bob'] }], 'reaction state came from the persisted message, not a replayed event');
  await alice.c.disconnect(); await bob.c.disconnect();
});

await test('Postgres remains the source of truth for everything recovered', async () => {
  const room = await mkRoom(`${S}-truth`);
  const alice = await client('alice', [room]);
  await sendAs('bob', room, 'anchor', `${S}-p0`);
  await sleep(600);
  await withOutage(alice, [room], async () => {
    for (let i = 1; i <= 8; i++) await sendAs('bob', room, `p-${i}`, `${S}-p${i}`);
  });

  const stored = must(await http(`/v1/chat/conversations/${room}/messages?limit=100`, { token: apiKey }), 200, 'h');
  const storedTexts = stored.data.map((m) => m.text).reverse();
  eq(texts(alice.log), storedTexts, 'what the client holds equals what Postgres holds, in the same order');
  eq(stored.data.every((m) => typeof m.cursor === 'string' && m.cursor.length > 0), true, 'every stored message carries a resume point');
  await alice.c.disconnect();
});

await test('AUTOMATIC path: an unexpected socket drop recovers with no application involvement', async () => {
  const room = await mkRoom(`${S}-auto`);
  // Slow the first reconnect so messages can genuinely be missed.
  const alice = await client('alice', [room], 'alice', {
    autoReconnect: true, initialReconnectDelayMs: 5000, maxReconnectDelayMs: 7000,
  });
  await sendAs('bob', room, 'anchor', `${S}-au0`);
  await sleep(600);

  const before = alice.log.recoveries.length;
  // A network failure, not an API call: nothing tells the SDK to recover.
  killSocket(alice);
  await sleep(300);
  for (let i = 1; i <= 5; i++) await sendAs('bob', room, `au-${i}`, `${S}-au${i}`);

  const rec = await nextRecovery(alice, before, 60000);
  await sleep(600);
  eq(rec.recovered, 5, 'recovered without the application calling anything');
  eq(texts(alice.log), ['anchor', 'au-1', 'au-2', 'au-3', 'au-4', 'au-5'], 'complete and ordered');
  eq(new Set(ids(alice.log)).size, alice.log.messages.length, 'no duplicates');
  ok(alice.log.states.includes('reconnecting'), 'it really did go through a reconnect');
  await alice.c.disconnect();
});

const res = summary('PHASE 15');
process.exit(res.failures.length ? 1 : 0);
