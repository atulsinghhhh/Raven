import { http, must, Client, sleep } from './lib.mjs';
import { test, note, eq, ok, summary } from './runner.mjs';
import ctx from './ctx.json' with { type: 'json' };
const { apiKey } = ctx;
const S = Date.now().toString(36);

console.log('\n########## PHASE 3 — TWO PARTICIPANTS ##########\n');

const conv = must(
  await http('/v1/chat/conversations', {
    method: 'POST',
    token: apiKey,
    body: {
      name: `p3-${S}`,
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

let alice = new Client(aliceGrant.token, 'alice'),
  bob = new Client(bobGrant.token, 'bob');
await alice.connect();
await bob.connect();
await alice.request('room.join', { room });
await bob.request('room.join', { room });
await sleep(200);

let aliceMsgId, bobMsgId;

await test('Alice → Bob: delivered exactly once, correct sender/room/id/timestamp', async () => {
  alice.clear();
  bob.clear();
  const t0 = Date.now();
  const bobGets = bob.waitFor((f) => f.type === 'message');
  const ack = await alice.request('message.send', { room, text: 'A→B', clientMessageId: `a1-${S}` });
  const f = await bobGets;
  await sleep(400);
  aliceMsgId = ack.message.id;
  eq(
    bob.frames.filter((x) => x.type === 'message' && x.message.id === aliceMsgId).length,
    1,
    'exactly one delivery to bob',
  );
  eq(
    alice.frames.filter((x) => x.type === 'message' && x.message.id === aliceMsgId).length,
    1,
    'exactly one echo to alice',
  );
  eq(f.message.senderId, 'alice', 'sender');
  eq(f.message.roomId, room, 'room');
  eq(f.message.id, aliceMsgId, 'id matches ack');
  const created = Date.parse(f.message.createdAt);
  ok(created >= t0 - 2000 && created <= Date.now() + 2000, `createdAt sane: ${f.message.createdAt}`);
  note(`persistLatencyMs=${ack.persistLatencyMs}`);
});

await test('Bob → Alice: delivered exactly once', async () => {
  alice.clear();
  bob.clear();
  const aliceGets = alice.waitFor((f) => f.type === 'message');
  const ack = await bob.request('message.send', { room, text: 'B→A', clientMessageId: `b1-${S}` });
  const f = await aliceGets;
  await sleep(400);
  bobMsgId = ack.message.id;
  eq(
    alice.frames.filter((x) => x.type === 'message' && x.message.id === bobMsgId).length,
    1,
    'exactly one delivery to alice',
  );
  eq(f.message.senderId, 'bob', 'sender');
  ok(bobMsgId !== aliceMsgId, 'distinct ids');
});

await test('both messages persisted with correct senders', async () => {
  const page = must(await http(`/v1/chat/conversations/${room}/messages`, { token: apiKey }), 200, 'history');
  eq(page.data.length, 2, 'two rows');
  eq(
    page.data.map((m) => [m.senderId, m.text]),
    [
      ['bob', 'B→A'],
      ['alice', 'A→B'],
    ],
    'newest-first, correct attribution',
  );
});

await test('Alice offline → Bob sends → Alice reconnects and catches up via `after`', async () => {
  // Capture Alice's last-seen cursor before going offline.
  const before = must(
    await http(`/v1/chat/conversations/${room}/messages?limit=1`, { token: aliceGrant.token }),
    200,
    'cursor',
  );
  const catchUpCursor = before.previousCursor;
  ok(catchUpCursor, 'previousCursor is the forward cursor');

  alice.close();
  await sleep(500);

  const missed = [];
  for (let i = 0; i < 3; i++) {
    const ack = await bob.request('message.send', {
      room,
      text: `while-offline-${i}`,
      clientMessageId: `off-${i}-${S}`,
    });
    missed.push(ack.message.id);
  }

  alice = new Client(aliceGrant.token, 'alice-reconnect');
  await alice.connect();
  await alice.request('room.join', { room });

  const page = must(
    await http(`/v1/chat/conversations/${room}/messages?after=${encodeURIComponent(catchUpCursor)}`, {
      token: aliceGrant.token,
    }),
    200,
    'catch-up',
  );
  const ids = page.data.map((m) => m.id);
  for (const id of missed) ok(ids.includes(id), `missed message ${id} recoverable`);
  eq(
    page.data.map((m) => m.text),
    ['while-offline-2', 'while-offline-1', 'while-offline-0'],
    'exactly the missed ones, newest-first',
  );
  note('catch-up is a manual messages.list({after}) call — the SDK does not do it automatically');
});

await test('after reconnect, live delivery resumes', async () => {
  alice.clear();
  const gets = alice.waitFor((f) => f.type === 'message', 5000);
  await bob.request('message.send', { room, text: 'after-reconnect', clientMessageId: `ar-${S}` });
  const f = await gets;
  eq(f.message.text, 'after-reconnect', 'live again');
});

alice.close();
bob.close();
const res = summary('PHASE 3');
process.exit(res.failures.length ? 1 : 0);
