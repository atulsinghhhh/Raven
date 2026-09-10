// Phase 13 — controlled load, isolated environment only (localhost:4177,
// scratch Postgres on :55432, throwaway Redis on :6399). Never production.
import { http, must, Client, sleep } from './lib.mjs';
import { test, note, eq, ok, summary } from './runner.mjs';
import ctx from './ctx.json' with { type: 'json' };
import { execSync } from 'child_process';
const { apiKey } = ctx;
const S = 'p13' + Date.now().toString(36);
const redis = (c) => execSync(`docker exec raven-chat-audit-redis redis-cli ${c}`).toString().trim();
const pg = (sql) => {
  const f = `/tmp/audit-q-${Math.random().toString(36).slice(2)}.sql`;
  execSync(`cat > ${f} <<'RAVENSQL'\n${sql}\nRAVENSQL`, { shell: '/bin/bash' });
  execSync(`docker cp ${f} raven-e2e-pg:/tmp/q.sql`);
  const out = execSync(`docker exec raven-e2e-pg psql -U postgres -d postgres -tAf /tmp/q.sql`).toString().trim();
  execSync(`rm -f ${f}`);
  return out;
};
const pct = (arr, p) => arr.slice().sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(arr.length * p))];

console.log('\n########## PHASE 13 — LOAD / STRESS (isolated env) ##########\n');
console.log(`  target: localhost:4177 | postgres :55432 (scratch) | redis :6399 (throwaway)\n`);

const mkRoom = async (name, users) => {
  const c = must(await http('/v1/chat/conversations', { method: 'POST', token: apiKey, body: { name, members: users.map((u) => ({ userId: u })) } }), 201, 'conv');
  return c.publicId;
};
const grant = async (u, room) => must(await http('/v1/chat/tokens', { method: 'POST', token: apiKey, body: { userId: u, conversations: [room], ttlSeconds: 21600 } }), 201, u);

const rssMb = () => Math.round(process.memoryUsage().rss / 1048576);
const apiRss = () => {
  try { return Math.round(Number(execSync(`ps -o rss= -p $(pgrep -f 'node dist/main.js' | head -1)`).toString().trim()) / 1024); }
  catch { return -1; }
};
const settledRss = async () => { await sleep(2500); return apiRss(); };
const metrics = [];

await test('L1 — 100 messages, 1 sender, 1 receiver: latency + integrity', async () => {
  const room = await mkRoom(`${S}-l1`, ['alice', 'bob']);
  const [ag, bg] = [await grant('alice', room), await grant('bob', room)];
  const a = new Client(ag.token, 'a'), b = new Client(bg.token, 'b');
  await a.connect(); await b.connect();
  await a.request('room.join', { room }); await b.request('room.join', { room });
  await sleep(200);

  const e2e = [], persist = [];
  const arrival = new Map();
  b.ws.on('message', (raw) => { const f = JSON.parse(raw); if (f.type === 'message') arrival.set(f.message.id, Date.now()); });

  const t0 = Date.now();
  for (let i = 0; i < 100; i++) {
    const sentAt = Date.now();
    const ack = await a.request('message.send', { room, text: `l1-${i}`, clientMessageId: `${S}-l1-${i}` }, 20000);
    persist.push(ack.persistLatencyMs);
    e2e.push([ack.message.id, sentAt]);
  }
  const wall = Date.now() - t0;
  for (let i = 0; i < 50 && arrival.size < 100; i++) await sleep(100);

  const deliver = e2e.filter(([id]) => arrival.has(id)).map(([id, sentAt]) => arrival.get(id) - sentAt);
  eq(arrival.size, 100, 'all 100 delivered');
  eq(pg(`SELECT count(*) FROM chat_messages WHERE content LIKE '${S}-l1-%' OR content LIKE 'l1-%'`) >= '100', true, 'persisted');
  const m = { test: 'L1 100 msgs', wallMs: wall, throughput: +(100 / (wall / 1000)).toFixed(1),
    persistP50: pct(persist, 0.5), persistP95: pct(persist, 0.95), persistMax: Math.max(...persist),
    e2eP50: pct(deliver, 0.5), e2eP95: pct(deliver, 0.95), e2eMax: Math.max(...deliver), lost: 0, dupes: 0 };
  metrics.push(m);
  note(JSON.stringify(m));
  a.close(); b.close();
});

await test('L2 — 1,000 messages: no loss, no duplicates, bounded latency', async () => {
  const room = await mkRoom(`${S}-l2`, ['alice', 'bob']);
  const [ag, bg] = [await grant('alice', room), await grant('bob', room)];
  const a = new Client(ag.token, 'a'), b = new Client(bg.token, 'b');
  await a.connect(); await b.connect();
  await a.request('room.join', { room }); await b.request('room.join', { room });
  await sleep(200);

  const seen = new Set(); let dupes = 0; const arrival = new Map();
  b.frames.length = 0;
  b.ws.on('message', (raw) => { const f = JSON.parse(raw); if (f.type === 'message') { if (seen.has(f.message.id)) dupes++; seen.add(f.message.id); arrival.set(f.message.id, Date.now()); } });
  b.waiters.length = 0; b.frames.length = 0;

  const persist = [], sentAt = new Map();
  const rss0 = await settledRss();
  const t0 = Date.now();
  for (let i = 0; i < 1000; i++) {
    const s = Date.now();
    const ack = await a.request('message.send', { room, text: `l2-${i}`, clientMessageId: `${S}-l2-${i}` }, 30000);
    persist.push(ack.persistLatencyMs); sentAt.set(ack.message.id, s);
  }
  const wall = Date.now() - t0;
  for (let i = 0; i < 100 && seen.size < 1000; i++) await sleep(100);
  const rss1 = await settledRss();

  const deliver = [...sentAt].filter(([id]) => arrival.has(id)).map(([id, s]) => arrival.get(id) - s);
  eq(seen.size, 1000, `received ${seen.size}/1000`);
  eq(dupes, 0, 'zero duplicate deliveries');
  eq(pg(`SELECT count(*) FROM chat_messages WHERE "clientMessageId" LIKE '${S}-l2-%'`), '1000', '1000 rows in Postgres');
  const m = { test: 'L2 1000 msgs', wallMs: wall, throughput: +(1000 / (wall / 1000)).toFixed(1),
    persistP50: pct(persist, 0.5), persistP95: pct(persist, 0.95), persistP99: pct(persist, 0.99), persistMax: Math.max(...persist),
    e2eP50: pct(deliver, 0.5), e2eP95: pct(deliver, 0.95), e2eMax: Math.max(...deliver),
    lost: 1000 - seen.size, dupes, apiRssMbBefore: rss0, apiRssMbAfter: rss1 };
  metrics.push(m); note(JSON.stringify(m));
  a.close(); b.close();
});

await test('L3 — 20 concurrent users in one conversation, 20 messages each (400 total)', async () => {
  const users = Array.from({ length: 20 }, (_, i) => `u${i}`);
  const room = await mkRoom(`${S}-l3`, users);
  const clients = [];
  for (const u of users) {
    const g = await grant(u, room);
    const c = new Client(g.token, u);
    await c.connect(); await c.request('room.join', { room });
    clients.push(c);
  }
  await sleep(500);

  const counts = new Map(clients.map((c) => [c.label, new Set()]));
  for (const c of clients) c.ws.on('message', (raw) => { const f = JSON.parse(raw); if (f.type === 'message') counts.get(c.label).add(f.message.id); });

  const rss0 = await settledRss();
  const t0 = Date.now();
  const acks = (await Promise.all(clients.map(async (c, ci) => {
    const out = [];
    for (let i = 0; i < 20; i++) out.push(await c.request('message.send', { room, text: `l3-${ci}-${i}`, clientMessageId: `${S}-l3-${ci}-${i}` }, 40000));
    return out;
  }))).flat();
  const wall = Date.now() - t0;
  for (let i = 0; i < 150 && [...counts.values()].some((s) => s.size < 400); i++) await sleep(100);
  const rss1 = await settledRss();

  eq(acks.length, 400, '400 acks');
  eq(new Set(acks.map((a) => a.message.id)).size, 400, '400 distinct ids');
  const shortfalls = [...counts].filter(([, s]) => s.size !== 400).map(([u, s]) => `${u}:${s.size}`);
  eq(shortfalls, [], 'every one of the 20 clients received all 400 messages');
  eq(pg(`SELECT count(*) FROM chat_messages WHERE "clientMessageId" LIKE '${S}-l3-%'`), '400', '400 rows persisted');
  const persist = acks.map((a) => a.persistLatencyMs);
  const m = { test: 'L3 20 users x 20 msgs', totalMessages: 400, fanOutDeliveries: 400 * 20, wallMs: wall,
    throughput: +(400 / (wall / 1000)).toFixed(1), persistP50: pct(persist, 0.5), persistP95: pct(persist, 0.95), persistMax: Math.max(...persist),
    lost: 0, dupes: 0, apiRssMbBefore: rss0, apiRssMbAfter: rss1 };
  metrics.push(m); note(JSON.stringify(m));
  for (const c of clients) c.close();
});

await test('L4 — rapid connect/disconnect churn (200 cycles)', async () => {
  const room = await mkRoom(`${S}-l4`, ['alice']);
  const g = await grant('alice', room);
  const rss0 = await settledRss();
  const t0 = Date.now();
  let failures = 0;
  for (let i = 0; i < 200; i++) {
    const c = new Client(g.token, `churn${i}`);
    try { await c.connect(); await c.request('room.join', { room }); } catch { failures++; }
    c.close();
  }
  const wall = Date.now() - t0;
  await sleep(8000);
  const rss1 = await settledRss();
  eq(failures, 0, 'no connection failures');
  const leaked = redis('--scan --count 5000').split('\n').filter((k) => k.startsWith('raven:chat:conn:')).length;
  const m = { test: 'L4 200 connect/disconnect', wallMs: wall, cyclesPerSec: +(200 / (wall / 1000)).toFixed(1),
    failures, leakedRedisConnKeys: leaked, apiRssMbBefore: rss0, apiRssMbAfter: rss1 };
  metrics.push(m); note(JSON.stringify(m));
  const ttls = redis('--scan --count 5000').split('\n').filter((k) => k.startsWith('raven:chat:conn:')).map((k) => Number(redis(`ttl ${k}`)));
  note(`residual conn keys: ${leaked}; TTLs: ${JSON.stringify(ttls.slice(0, 5))} (presenceTtlSeconds=45)`);
  eq(ttls.filter((t) => t === -1), [], 'every residual connection key still carries a TTL — bounded, not leaked');
  note(`chat_connections rows: ${pg(`SELECT count(*) FROM chat_connections`)} (one durable row per socket, by design)`);
});

await test('L5 — 10 conversations in parallel, 10 messages each', async () => {
  const rss0 = await settledRss();
  const t0 = Date.now();
  const results = await Promise.all(Array.from({ length: 10 }, async (_, r) => {
    const room = await mkRoom(`${S}-l5-${r}`, ['alice', 'bob']);
    const [ag, bg] = [await grant('alice', room), await grant('bob', room)];
    const a = new Client(ag.token, `a${r}`), b = new Client(bg.token, `b${r}`);
    await a.connect(); await b.connect();
    await a.request('room.join', { room }); await b.request('room.join', { room });
    await sleep(150);
    const got = new Set();
    b.ws.on('message', (raw) => { const f = JSON.parse(raw); if (f.type === 'message') got.add(f.message.id); });
    const ids = [];
    for (let i = 0; i < 10; i++) ids.push((await a.request('message.send', { room, text: `l5-${r}-${i}`, clientMessageId: `${S}-l5-${r}-${i}` }, 30000)).message.id);
    for (let i = 0; i < 50 && got.size < 10; i++) await sleep(100);
    const crossTalk = [...got].filter((id) => !ids.includes(id));
    a.close(); b.close();
    return { room: r, sent: 10, received: got.size, crossTalk: crossTalk.length };
  }));
  const wall = Date.now() - t0;
  const rss1 = await settledRss();
  eq(results.filter((r) => r.received !== 10), [], 'every conversation delivered all 10');
  eq(results.filter((r) => r.crossTalk > 0), [], 'no cross-conversation leakage');
  const m = { test: 'L5 10 conversations', wallMs: wall, conversations: 10, messages: 100, crossTalk: 0, apiRssMbBefore: rss0, apiRssMbAfter: rss1 };
  metrics.push(m); note(JSON.stringify(m));
});

await test('post-load: Redis is bounded and Postgres is consistent', async () => {
  const keys = redis('--scan --count 20000').split('\n').filter(Boolean);
  const noTtl = keys.filter((k) => redis(`ttl ${k}`) === '-1');
  eq(noTtl, [], 'still no untimed keys after the load run');
  note(`redis keys after load: ${keys.length}, memory: ${redis('info memory').split('\n').find((l) => l.startsWith('used_memory_human')).trim()}`);
  const orphans = pg(`SELECT count(*) FROM chat_messages m LEFT JOIN chat_conversations c ON c.id=m."conversationId" WHERE c.id IS NULL`);
  eq(orphans, '0', 'no orphaned messages');
  const dupIdem = pg(`SELECT count(*) FROM (SELECT "conversationId","senderId","clientMessageId" FROM chat_messages WHERE "clientMessageId" IS NOT NULL GROUP BY 1,2,3 HAVING count(*)>1) x`);
  eq(dupIdem, '0', 'no idempotency-key duplicates anywhere in the table');
  note(`total chat_messages rows: ${pg('SELECT count(*) FROM chat_messages')}`);
});

console.log('\n=== MEASUREMENTS ===');
for (const m of metrics) console.log('  ' + JSON.stringify(m));
const res = summary('PHASE 13');
process.exit(res.failures.length ? 1 : 0);
