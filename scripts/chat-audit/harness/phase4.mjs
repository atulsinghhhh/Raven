import { http, must, Client, sleep } from './lib.mjs';
import { test, note, eq, ok, summary } from './runner.mjs';
import ctx from './ctx.json' with { type: 'json' };
const { apiKey } = ctx;
const S = Date.now().toString(36);

console.log('\n########## PHASE 4 — PRESENCE ##########\n');

const conv = must(
  await http('/v1/chat/conversations', {
    method: 'POST',
    token: apiKey,
    body: {
      name: `p4-${S}`,
      members: [{ userId: 'alice' }, { userId: 'bob' }],
    },
  }),
  201,
  'conv',
);
const room = conv.publicId;
const grant = async (u) =>
  must(
    await http('/v1/chat/tokens', { method: 'POST', token: apiKey, body: { userId: u, conversations: [room] } }),
    201,
    `mint ${u}`,
  );
const aliceGrant = await grant('alice'),
  bobGrant = await grant('bob');

const presence = async () =>
  must(await http(`/v1/chat/conversations/${room}/presence`, { token: apiKey }), 200, 'presence');

let a1, a2, bobC;

await test('online on join', async () => {
  a1 = new Client(aliceGrant.token, 'alice-b1');
  await a1.connect();
  await a1.request('room.join', { room });
  await sleep(200);
  const p = await presence();
  eq(p, [{ userId: 'alice', status: 'online' }], 'alice online');
});

await test('second participant sees presence event', async () => {
  bobC = new Client(bobGrant.token, 'bob');
  await bobC.connect();
  const joined = await bobC.request('room.join', { room });
  eq(
    joined.presence.map((p) => p.userId).sort(),
    ['alice', 'bob'],
    'join snapshot carries everyone present, joiner included',
  );
  await sleep(300);
  const aliceSaw = a1.frames.find((f) => f.type === 'presence' && f.userId === 'bob' && f.status === 'online');
  ok(aliceSaw, 'alice received bob presence:online');
});

await test('offline on clean disconnect', async () => {
  bobC.clear();
  const gone = bobC.waitFor(
    (f) => f.type === 'presence' && f.userId === 'alice' && f.status === 'offline',
    5000,
    'alice offline',
  );
  a1.close();
  await gone;
  await sleep(200);
  const p = await presence();
  eq(
    p.map((x) => x.userId),
    ['bob'],
    'alice no longer present',
  );
});

await test('MULTI-SESSION: Alice in 2 browsers, close browser 1 → Alice must stay online', async () => {
  a1 = new Client(aliceGrant.token, 'alice-b1');
  a2 = new Client(aliceGrant.token, 'alice-b2');
  await a1.connect();
  await a2.connect();
  await a1.request('room.join', { room });
  await a2.request('room.join', { room });
  await sleep(300);
  eq((await presence()).find((p) => p.userId === 'alice')?.status, 'online', 'alice online with 2 sessions');

  bobC.clear();
  a1.close(); // close browser 1
  await sleep(800); // well before any heartbeat re-set (25s)

  const p = await presence();
  const alicePresence = p.find((x) => x.userId === 'alice');
  const offlineEvents = bobC.frames.filter(
    (f) => f.type === 'presence' && f.userId === 'alice' && f.status === 'offline',
  );
  note(`presence after closing browser 1: ${JSON.stringify(p)}`);
  note(`offline events observed by bob: ${offlineEvents.length}`);
  ok(alicePresence?.status === 'online', 'Alice must remain online while browser 2 is still connected');
  eq(offlineEvents.length, 0, 'no spurious offline event broadcast');
});

await test('close browser 2 → Alice goes offline', async () => {
  bobC.clear();
  const gone = bobC.waitFor(
    (f) => f.type === 'presence' && f.userId === 'alice' && f.status === 'offline',
    5000,
    'alice offline',
  );
  a2.close();
  await gone;
  await sleep(200);
  ok(!(await presence()).some((p) => p.userId === 'alice'), 'alice offline after last session closes');
});

await test('reconnect restores presence', async () => {
  const a3 = new Client(aliceGrant.token, 'alice-b3');
  await a3.connect();
  await a3.request('room.join', { room });
  await sleep(250);
  eq((await presence()).find((p) => p.userId === 'alice')?.status, 'online', 'online again after reconnect');
  a3.close();
});

await test("presence.set(away) applies across the connection's rooms", async () => {
  const a4 = new Client(aliceGrant.token, 'alice-away');
  await a4.connect();
  await a4.request('room.join', { room });
  await sleep(200);
  bobC.clear();
  a4.send({ type: 'presence.set', status: 'away' });
  await bobC.waitFor((f) => f.type === 'presence' && f.userId === 'alice' && f.status === 'away', 5000, 'away event');
  eq((await presence()).find((p) => p.userId === 'alice')?.status, 'away', 'away persisted in redis view');
  a4.close();
});

bobC.close();
const res = summary('PHASE 4');
process.exit(res.failures.length ? 1 : 0);
