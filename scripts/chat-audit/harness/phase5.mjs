import { http, must, Client, sleep } from './lib.mjs';
import { test, note, eq, ok, summary } from './runner.mjs';
import ctx from './ctx.json' with { type: 'json' };
const { apiKey } = ctx;
const S = 'p5' + Date.now().toString(36);

console.log('\n########## PHASE 5 — TYPING ##########\n');
const conv = must(
  await http('/v1/chat/conversations', {
    method: 'POST',
    token: apiKey,
    body: {
      name: S,
      members: [{ userId: 'alice' }, { userId: 'bob' }, { userId: 'carol' }],
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
    u,
  );
const ag = await grant('alice'),
  bg = await grant('bob'),
  cg = await grant('carol');

let alice = new Client(ag.token, 'alice'),
  bob = new Client(bg.token, 'bob'),
  carol = new Client(cg.token, 'carol');
for (const [c] of [
  [alice, ag],
  [bob, bg],
  [carol, cg],
]) {
  await c.connect();
  await c.request('room.join', { room });
}
await sleep(250);

const historyCount = async () =>
  must(await http(`/v1/chat/conversations/${room}/messages?limit=100`, { token: apiKey }), 200, 'h').data.length;
const baseline = await historyCount();

await test('Alice starts typing → Bob receives typing.started', async () => {
  bob.clear();
  alice.send({ type: 'typing.start', room });
  const f = await bob.waitFor((x) => x.type === 'typing.started', 5000, 'typing.started');
  eq(f.userId, 'alice', 'userId');
  eq(f.roomId, room, 'roomId');
});

await test('typing echo is not sent back to the typist', async () => {
  await sleep(300);
  eq(alice.frames.filter((f) => f.type === 'typing.started').length, 0, 'alice does not see her own typing');
});

await test('Alice stops typing → Bob receives typing.stopped', async () => {
  bob.clear();
  alice.send({ type: 'typing.stop', room });
  const f = await bob.waitFor((x) => x.type === 'typing.stopped', 5000, 'typing.stopped');
  eq(f.userId, 'alice', 'userId');
});

await test('rapid typing → one started event, not N', async () => {
  bob.clear();
  for (let i = 0; i < 15; i++) {
    alice.send({ type: 'typing.start', room });
    await sleep(20);
  }
  await sleep(600);
  const started = bob.frames.filter((f) => f.type === 'typing.started');
  eq(started.length, 1, `exactly one typing.started for 15 keystrokes (got ${started.length})`);
});

await test('typing TTL expires on its own (no stop frame sent)', async () => {
  // CHAT_TYPING_TTL_SECONDS=7 in this environment.
  const t = must(await http(`/v1/chat/conversations/${room}/typing`, { token: apiKey }), 200, 't');
  eq(t.userIds, ['alice'], 'alice currently typing');
  await sleep(8000);
  const t2 = must(await http(`/v1/chat/conversations/${room}/typing`, { token: apiKey }), 200, 't2');
  eq(t2.userIds, [], 'typing expired without any stop frame');
  note(
    'TTL-driven expiry works; note no typing.stopped event is broadcast on expiry — clients rely on their own local timer',
  );
});

await test('multiple participants typing simultaneously', async () => {
  carol.clear();
  alice.send({ type: 'typing.start', room });
  bob.send({ type: 'typing.start', room });
  await sleep(500);
  const who = carol.frames
    .filter((f) => f.type === 'typing.started')
    .map((f) => f.userId)
    .sort();
  eq(who, ['alice', 'bob'], 'carol sees both');
  const t = must(await http(`/v1/chat/conversations/${room}/typing`, { token: apiKey }), 200, 't');
  eq(t.userIds.sort(), ['alice', 'bob'], 'REST view agrees');
});

await test("reconnect during typing clears that connection's typing state", async () => {
  bob.clear();
  alice.close();
  await bob.waitFor((f) => f.type === 'typing.stopped' && f.userId === 'alice', 5000, 'stopped on disconnect');
  const t = must(await http(`/v1/chat/conversations/${room}/typing`, { token: apiKey }), 200, 't');
  ok(!t.userIds.includes('alice'), 'alice no longer typing after disconnect');
  alice = new Client(ag.token, 'alice2');
  await alice.connect();
  await alice.request('room.join', { room });
  const joined = alice.frames.find((f) => f.type === 'room.joined');
  note(`typing snapshot on rejoin: ${JSON.stringify(joined.typing)}`);
  ok(!joined.typing.includes('alice'), 'own stale typing not resurrected');
});

await test('MULTI-SESSION typing: second session must not be cleared by the first closing', async () => {
  const a1 = new Client(ag.token, 'a1');
  await a1.connect();
  await a1.request('room.join', { room });
  const a2 = new Client(ag.token, 'a2');
  await a2.connect();
  await a2.request('room.join', { room });
  await sleep(200);
  a2.send({ type: 'typing.start', room });
  await sleep(400);
  a1.close();
  await sleep(600);
  const t = must(await http(`/v1/chat/conversations/${room}/typing`, { token: apiKey }), 200, 't');
  note(`typing after unrelated session closed: ${JSON.stringify(t.userIds)}`);
  ok(t.userIds.includes('alice'), 'alice still typing from session a2');
  a2.close();
});

await test('typing NEVER creates persistent messages', async () => {
  const after = await historyCount();
  eq(after, baseline, `message count unchanged (${baseline})`);
});

alice.close();
bob.close();
carol.close();
const res = summary('PHASE 5');
process.exit(res.failures.length ? 1 : 0);
