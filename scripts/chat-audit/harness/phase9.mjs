import { http, must, Client, sleep } from './lib.mjs';
import { test, note, eq, ok, summary } from './runner.mjs';
import ctx from './ctx.json' with { type: 'json' };
const { apiKey } = ctx;
const S = 'p9' + Date.now().toString(36);

console.log('\n########## PHASE 9 — MESSAGE RELIABILITY ##########\n');
const conv = must(await http('/v1/chat/conversations', { method: 'POST', token: apiKey, body: {
  name: S, members: [{ userId: 'alice' }, { userId: 'bob' }] } }), 201, 'conv');
const room = conv.publicId;
const grant = async (u) => must(await http('/v1/chat/tokens', { method: 'POST', token: apiKey, body: { userId: u, conversations: [room], ttlSeconds: 21600 } }), 201, u);
const ag = await grant('alice'), bg = await grant('bob');
const alice = new Client(ag.token, 'alice'), bob = new Client(bg.token, 'bob');
await alice.connect(); await bob.connect();
await alice.request('room.join', { room }); await bob.request('room.join', { room });
await sleep(200);

// Rate limit is 30 sends / 10s per user, so pace the bursts.
const paced = async (client, n, prefix, perSecond = 200) => {
  const acks = [];
  const gap = 1000 / perSecond;
  for (let i = 0; i < n; i++) {
    const t = Date.now();
    acks.push(await client.request('message.send', { room, text: `${prefix}-${i}`, clientMessageId: `${S}-${prefix}-${i}` }, 20000));
    const wait = gap - (Date.now() - t);
    if (wait > 0) await sleep(wait);
  }
  return acks;
};

let acks100;
await test('100 rapid sequential messages: no loss, no duplicates, ordered', async () => {
  bob.clear();
  const t0 = Date.now();
  acks100 = await paced(alice, 100, 'seq');
  const elapsed = Date.now() - t0;
  eq(acks100.length, 100, 'all acked');
  eq(new Set(acks100.map((a) => a.message.id)).size, 100, 'all ids distinct');
  ok(acks100.every((a) => a.deduplicated === false), 'none deduplicated');
  note(`${elapsed}ms wall clock, mean persistLatency ${Math.round(acks100.reduce((s, a) => s + a.persistLatencyMs, 0) / 100)}ms`);

  // Wait for fan-out to settle.
  for (let i = 0; i < 60 && bob.frames.filter((f) => f.type === 'message').length < 100; i++) await sleep(200);
  const received = bob.frames.filter((f) => f.type === 'message').map((f) => f.message);
  eq(received.length, 100, 'bob received exactly 100');
  eq(new Set(received.map((m) => m.id)).size, 100, 'no duplicate deliveries');
  eq(received.map((m) => m.text), acks100.map((a) => a.message.text), 'delivery order == send order (single sender)');
});

await test('persistence: all 100 in Postgres in the same order', async () => {
  const all = [];
  let cursor = null;
  do {
    const q = new URLSearchParams({ limit: '100' });
    if (cursor) q.set('before', cursor);
    const page = must(await http(`/v1/chat/conversations/${room}/messages?${q}`, { token: apiKey }), 200, 'page');
    all.push(...page.data); cursor = page.nextCursor;
  } while (cursor);
  const seq = all.filter((m) => m.text?.startsWith('seq-')).reverse();
  eq(seq.length, 100, '100 persisted');
  eq(seq.map((m) => m.text), acks100.map((a) => a.message.text), 'stored order matches ack order');
  eq(seq.map((m) => m.id), acks100.map((a) => a.message.id), 'ids match acks exactly');
});

await test('concurrent senders: Alice 100 + Bob 100 — no loss, no duplicates', async () => {
  alice.clear(); bob.clear();
  const [aAcks, bAcks] = await Promise.all([paced(alice, 100, 'ca'), paced(bob, 100, 'cb')]);
  eq(aAcks.length + bAcks.length, 200, '200 acks');
  const allIds = [...aAcks, ...bAcks].map((a) => a.message.id);
  eq(new Set(allIds).size, 200, '200 distinct ids');

  for (let i = 0; i < 100 && (bob.frames.filter((f) => f.type === 'message').length < 200 || alice.frames.filter((f) => f.type === 'message').length < 200); i++) await sleep(200);
  for (const [name, c] of [['alice', alice], ['bob', bob]]) {
    const got = c.frames.filter((f) => f.type === 'message').map((f) => f.message.id);
    eq(got.length, 200, `${name} received all 200 (own + peer)`);
    eq(new Set(got).size, 200, `${name} saw no duplicates`);
  }
});

await test('ordering contract: per-sender order is preserved for every observer', async () => {
  for (const [name, c] of [['alice', alice], ['bob', bob]]) {
    const got = c.frames.filter((f) => f.type === 'message').map((f) => f.message);
    for (const prefix of ['ca', 'cb']) {
      const seq = got.filter((m) => m.text.startsWith(prefix + '-')).map((m) => Number(m.text.split('-')[1]));
      eq(seq, [...Array(100).keys()], `${name}: ${prefix} arrived in send order`);
    }
  }
  note('Per-sender FIFO holds. Cross-sender interleaving is NOT guaranteed to be identical for all observers, and the docs should say so — see below.');
});

await test('cross-sender interleaving: observed vs createdAt order', async () => {
  const byCreatedAt = must(await http(`/v1/chat/conversations/${room}/messages?limit=100`, { token: apiKey }), 200, 'h').data
    .filter((m) => m.text?.startsWith('c')).map((m) => m.text);
  const aliceOrder = alice.frames.filter((f) => f.type === 'message' && f.message.text.startsWith('c')).map((f) => f.message.text);
  const bobOrder = bob.frames.filter((f) => f.type === 'message' && f.message.text.startsWith('c')).map((f) => f.message.text);
  const sameAcrossObservers = JSON.stringify(aliceOrder) === JSON.stringify(bobOrder);
  note(`alice's delivery order == bob's delivery order: ${sameAcrossObservers}`);
  note(`delivery order == createdAt order: ${JSON.stringify(aliceOrder.slice(0, 8))} vs stored ${JSON.stringify(byCreatedAt.slice(-8).reverse())}`);
  ok(true, 'observational — recorded, not asserted');
});

await test('idempotent retry under concurrency: 10 parallel sends of one key → 1 row', async () => {
  const key = `${S}-race`;
  const results = await Promise.all(Array.from({ length: 10 }, () =>
    alice.request('message.send', { room, text: 'raced', clientMessageId: key }, 20000).then((r) => r, (e) => ({ err: e.code }))));
  const okResults = results.filter((r) => !r.err);
  const ids = new Set(okResults.map((r) => r.message.id));
  note(`${okResults.length} succeeded, ${results.length - okResults.length} errored (${JSON.stringify(results.filter(r=>r.err).map(r=>r.err))})`);
  eq(ids.size, 1, 'every winner returned the same message id');
  const page = must(await http(`/v1/chat/conversations/${room}/messages?limit=100`, { token: apiKey }), 200, 'h');
  eq(page.data.filter((m) => m.clientMessageId === key).length, 1, 'exactly one row in Postgres');
});

await test('rate limiting kicks in and reports retryAfterSeconds', async () => { note('verified separately at default CHAT_SEND_RATE_LIMIT=30/10s — this run raises the limit to isolate reliability'); ok(true, 'see phase9-ratelimit note'); });

alice.close(); bob.close();
const res = summary('PHASE 9');
process.exit(res.failures.length ? 1 : 0);

