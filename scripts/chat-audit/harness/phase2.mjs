import { http, must, Client, sleep } from './lib.mjs';
import { test, note, eq, ok, summary } from './runner.mjs';
import ctx from './ctx.json' with { type: 'json' };

const { apiKey, projectId } = ctx;
const S = Date.now().toString(36);
let room, conv, aliceGrant, bobGrant;

console.log('\n########## PHASE 2 — BASIC CHAT ##########\n');

await test('7. create conversation (server actor)', async () => {
  conv = must(await http('/v1/chat/conversations', { method: 'POST', token: apiKey, body: {
    name: `p2-${S}`, members: [{ userId: 'alice', role: 'ADMIN' }, { userId: 'bob' }],
  } }), 201, 'create conversation');
  room = conv.publicId;
  ok(room.startsWith('conv_'), `publicId should be conv_*, got ${room}`);
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const leaked = Object.entries(conv).filter(([, v]) => typeof v === 'string' && UUID.test(v));
  eq(leaked, [], 'no internal uuid anywhere in the conversation response');
  eq(conv.id, conv.publicId, 'id and publicId are both the public conv_ id');
  note(`fields: ${Object.keys(conv).join(', ')}`);
});

await test('8. list conversations', async () => {
  const list = must(await http('/v1/chat/conversations', { token: apiKey }), 200, 'list');
  ok(Array.isArray(list) && list.some((c) => c.publicId === room), 'new conversation present in list');
});

await test('9. get conversation by publicId and by name', async () => {
  const byId = must(await http(`/v1/chat/conversations/${room}`, { token: apiKey }), 200, 'get by publicId');
  eq(byId.publicId, room, 'publicId');
  const byName = must(await http(`/v1/chat/conversations/p2-${S}`, { token: apiKey }), 200, 'get by name');
  eq(byName.publicId, room, 'resolve by name');
});

await test('10. add member', async () => {
  const m = must(await http(`/v1/chat/conversations/${room}/members`, { method: 'POST', token: apiKey, body: { userId: 'carol' } }), 201, 'add member');
  eq(m.userId, 'carol', 'member userId');
  const members = must(await http(`/v1/chat/conversations/${room}/members`, { token: apiKey }), 200, 'list members');
  eq(members.map((m) => m.userId).sort(), ['alice', 'bob', 'carol'], 'member list');
});

await test('11. remove member (soft)', async () => {
  const r = await http(`/v1/chat/conversations/${room}/members/carol`, { method: 'DELETE', token: apiKey });
  must(r, 204, 'remove member');
  const members = must(await http(`/v1/chat/conversations/${room}/members`, { token: apiKey }), 200, 'list members');
  eq(members.map((m) => m.userId).sort(), ['alice', 'bob'], 'carol gone from active list');
});

await test('3. mint chat tokens', async () => {
  aliceGrant = must(await http('/v1/chat/tokens', { method: 'POST', token: apiKey, body: { userId: 'alice', conversations: [room] } }), 201, 'mint alice');
  bobGrant = must(await http('/v1/chat/tokens', { method: 'POST', token: apiKey, body: { userId: 'bob', conversations: [room] } }), 201, 'mint bob');
  ok(aliceGrant.chatUrl?.startsWith('ws'), `chatUrl present: ${aliceGrant.chatUrl}`);
  ok(aliceGrant.apiUrl, 'apiUrl present');
  eq(aliceGrant.scopes, ['chat:read', 'chat:send', 'chat:moderate', 'chat:manage'], 'alice is ADMIN → all scopes');
  eq(bobGrant.scopes, ['chat:read', 'chat:send'], 'bob is MEMBER → read+send');
});

await test('3b. browser token cannot mint another token', async () => {
  const r = await http('/v1/chat/tokens', { method: 'POST', token: aliceGrant.token, body: { userId: 'mallory' } });
  eq(r.status, 403, 'client actor minting is forbidden');
});

let alice, bob;
await test('4. connect', async () => {
  alice = new Client(aliceGrant.token, 'alice');
  const hello = await alice.connect();
  eq(hello.userId, 'alice', 'connected frame userId');
  ok(hello.connectionId?.startsWith('ccn_'), 'connectionId');
  ok(typeof hello.heartbeatIntervalMs === 'number', 'heartbeatIntervalMs advertised');
  ok(hello.expiresAt, 'expiresAt advertised');
});

await test('7b. join room', async () => {
  const joined = await alice.request('room.join', { room });
  eq(joined.type, 'room.joined', 'room.joined frame');
  eq(joined.room, room, 'room echoed as publicId');
  ok(Array.isArray(joined.presence), 'presence snapshot');
  ok(Array.isArray(joined.typing), 'typing snapshot');
});

await test('12/13. send + receive (two clients)', async () => {
  bob = new Client(bobGrant.token, 'bob');
  await bob.connect();
  await bob.request('room.join', { room });
  await sleep(150);

  const bobGets = bob.waitFor((f) => f.type === 'message', 5000, 'message fanout');
  const ack = await alice.request('message.send', { room, text: 'hello from alice', clientMessageId: 'cm-1' });
  ok(ack.message.id.startsWith('msg_'), 'canonical msg_ id in ack');
  eq(ack.status, 'stored', 'ack says stored');
  eq(ack.deduplicated, false, 'not deduplicated');
  const f = await bobGets;
  eq(f.message.id, ack.message.id, 'bob got the same message id');
  eq(f.message.senderId, 'alice', 'sender');
  eq(f.message.roomId, room, 'roomId is the public conv id');
  ok(!('conversationId' in f), 'internal routing conversationId not leaked at top level');
  note(`message.conversationId field = ${f.message.conversationId} (public id: ${f.message.conversationId === room})`);
});

await test('12b. sender receives its own message back (echo)', async () => {
  const own = alice.frames.filter((f) => f.type === 'message' && f.message.text === 'hello from alice');
  eq(own.length, 1, 'sender got exactly one echo of its own message');
});

await test('16. idempotency — same clientMessageId returns the same row', async () => {
  const first = alice.frames.find((f) => f.type === 'message' && f.message.clientMessageId === 'cm-1');
  const ack = await alice.request('message.send', { room, text: 'hello from alice', clientMessageId: 'cm-1' });
  eq(ack.deduplicated, true, 'second send deduplicated');
  eq(ack.message.id, first.message.id, 'same server id returned');
});

await test('14. fetch history over REST with a browser token', async () => {
  const page = must(await http(`/v1/chat/conversations/${room}/messages`, { token: bobGrant.token }), 200, 'history');
  ok(Array.isArray(page.data), 'data array');
  eq(page.data.length, 1, 'exactly one message stored (idempotency held)');
  eq(page.data[0].senderId, 'alice', 'sender persisted');
  eq(page.hasMore, false, 'hasMore false');
});

await test('15. pagination — 25 messages, limit 10', async () => {
  for (let i = 0; i < 25; i++) {
    await alice.request('message.send', { room, text: `p-${i}`, clientMessageId: `pg-${i}` });
  }
  const seen = [];
  let cursor = null, pages = 0;
  do {
    const q = new URLSearchParams({ limit: '10' });
    if (cursor) q.set('before', cursor);
    const page = must(await http(`/v1/chat/conversations/${room}/messages?${q}`, { token: bobGrant.token }), 200, 'page');
    seen.push(...page.data.map((m) => m.text));
    cursor = page.nextCursor; pages++;
    if (pages > 10) throw new Error('pagination did not terminate');
  } while (cursor);
  eq(seen.length, 26, `saw all 26 messages across ${pages} pages`);
  eq(new Set(seen).size, 26, 'no duplicates across pages');
  const expected = [...Array(25).keys()].map((i) => `p-${24 - i}`).concat(['hello from alice']);
  eq(seen, expected, 'newest-first order preserved across pages');
  note(`${pages} pages`);
});

await test('15b. invalid cursor is rejected cleanly', async () => {
  const r = await http(`/v1/chat/conversations/${room}/messages?before=!!!notacursor`, { token: bobGrant.token });
  eq(r.status, 400, 'malformed cursor → 400');
  note(`code=${r.body?.error?.code ?? r.body?.code}`);
});

await test('5. disconnect', async () => {
  alice.close();
  await sleep(400);
  ok(alice.ws.readyState === 3, 'socket closed');
});

await test('6. reconnect with the same token', async () => {
  const alice2 = new Client(aliceGrant.token, 'alice2');
  const hello = await alice2.connect();
  eq(hello.userId, 'alice', 'same identity after reconnect');
  ok(hello.connectionId !== alice.connectionId, 'new connectionId');
  await alice2.request('room.join', { room });
  alice2.close();
});

bob.close();
const res = summary('PHASE 2');
process.exit(res.failures.length ? 1 : 0);
