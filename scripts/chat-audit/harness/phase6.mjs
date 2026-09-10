import { http, must, Client, sleep } from './lib.mjs';
import { test, note, eq, ok, summary } from './runner.mjs';
import ctx from './ctx.json' with { type: 'json' };
const { apiKey } = ctx;
const S = 'p6' + Date.now().toString(36);

console.log('\n########## PHASE 6 — READ RECEIPTS ##########\n');
const conv = must(
  await http('/v1/chat/conversations', {
    method: 'POST',
    token: apiKey,
    body: {
      name: S,
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
    u,
  );
const ag = await grant('alice'),
  bg = await grant('bob');
let alice = new Client(ag.token, 'alice'),
  bob = new Client(bg.token, 'bob');
await alice.connect();
await bob.connect();
await alice.request('room.join', { room });
await bob.request('room.join', { room });
await sleep(200);

const ids = [];
await test('setup: Alice sends 10 messages', async () => {
  for (let i = 1; i <= 10; i++) {
    const ack = await alice.request('message.send', { room, text: `m${i}`, clientMessageId: `${S}-${i}` });
    ids.push(ack.message.id);
  }
  eq(ids.length, 10, '10 ids');
});

await test('Bob unread count is 10 before reading', async () => {
  const st = must(await http(`/v1/chat/conversations/${room}/read-state`, { token: bg.token }), 200, 'read-state');
  eq(st.unreadCount, 10, 'unread=10');
  eq(st.lastReadMessageId, null, 'no read position yet');
});

await test('Alice unread count is 0 (own messages never unread)', async () => {
  const st = must(await http(`/v1/chat/conversations/${room}/read-state`, { token: ag.token }), 200, 'read-state');
  eq(st.unreadCount, 0, 'own messages excluded');
});

await test('Bob marks message 6 read → Alice receives a read event', async () => {
  alice.clear();
  const got = alice.waitFor((f) => f.type === 'read', 5000, 'read event');
  const state = await bob.request('read.mark', { messageId: ids[5] });
  eq(state.lastReadMessageId, ids[5], 'read position is message 6');
  eq(state.unreadCount, 4, 'partial read: 4 of 10 remain unread');
  const ev = await got;
  eq(ev.userId, 'bob', 'read event names bob');
  eq(ev.messageId, ids[5], 'read event names message 6');
  eq(ev.roomId, room, 'roomId');
});

await test('1–6 read, 7–10 unread (verified against message list)', async () => {
  const st = must(await http(`/v1/chat/conversations/${room}/read-state`, { token: bg.token }), 200, 's');
  const page = must(await http(`/v1/chat/conversations/${room}/messages?limit=100`, { token: apiKey }), 200, 'h');
  const lastReadAt = Date.parse(st.lastReadAt);
  const read = page.data
    .filter((m) => Date.parse(m.createdAt) <= lastReadAt)
    .map((m) => m.text)
    .sort();
  const unread = page.data
    .filter((m) => Date.parse(m.createdAt) > lastReadAt)
    .map((m) => m.text)
    .sort();
  eq(read, ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'], 'messages 1-6 are at/behind the marker');
  eq(unread, ['m10', 'm7', 'm8', 'm9'], 'messages 7-10 are ahead of it');
  eq(st.unreadCount, 4, 'unreadCount agrees');
});

await test('read state is persisted (survives a fresh REST read with a new token)', async () => {
  const fresh = await grant('bob');
  const st = must(await http(`/v1/chat/conversations/${room}/read-state`, { token: fresh.token }), 200, 's');
  eq(st.lastReadMessageId, ids[5], 'position persisted in Postgres');
  eq(st.unreadCount, 4, 'unread count persisted');
});

await test('reconnect preserves read state', async () => {
  bob.close();
  await sleep(300);
  bob = new Client(bg.token, 'bob2');
  await bob.connect();
  await bob.request('room.join', { room });
  const st = must(await http(`/v1/chat/conversations/${room}/read-state`, { token: bg.token }), 200, 's');
  eq(st.lastReadMessageId, ids[5], 'unchanged after reconnect');
});

await test('marker never moves backwards', async () => {
  const st = await bob.request('read.mark', { messageId: ids[2] }); // message 3, older
  eq(st.lastReadMessageId, ids[5], 'still message 6');
  eq(st.unreadCount, 4, 'unread unchanged');
});

await test('marking the newest message zeroes the unread count', async () => {
  const st = await bob.request('read.mark', { messageId: ids[9] });
  eq(st.lastReadMessageId, ids[9], 'position is message 10');
  eq(st.unreadCount, 0, 'nothing unread');
});

await test('read receipts list shows every member position', async () => {
  await alice.request('read.mark', { messageId: ids[9] });
  const rs = must(await http(`/v1/chat/conversations/${room}/read-receipts`, { token: apiKey }), 200, 'rr');
  const byUser = Object.fromEntries(rs.map((r) => [r.userId, r.lastReadMessageId]));
  eq(byUser.bob, ids[9], 'bob position');
  eq(byUser.alice, ids[9], 'alice position');
  note('listForConversation returns unreadCount: 0 for everyone by design — documented as not computed there');
});

await test('a new message after reading makes it unread again', async () => {
  await alice.request('message.send', { room, text: 'm11', clientMessageId: `${S}-11` });
  await sleep(200);
  const st = must(await http(`/v1/chat/conversations/${room}/read-state`, { token: bg.token }), 200, 's');
  eq(st.unreadCount, 1, 'one new unread');
});

await test('deleted messages do not count as unread', async () => {
  const ack = await alice.request('message.send', { room, text: 'm12', clientMessageId: `${S}-12` });
  await sleep(150);
  let st = must(await http(`/v1/chat/conversations/${room}/read-state`, { token: bg.token }), 200, 's');
  eq(st.unreadCount, 2, 'two unread before delete');
  await alice.request('message.delete', { messageId: ack.message.id });
  await sleep(150);
  st = must(await http(`/v1/chat/conversations/${room}/read-state`, { token: bg.token }), 200, 's');
  eq(st.unreadCount, 1, 'deleted message excluded from unread');
});

await test('read.mark on a message in another conversation is refused', async () => {
  const other = must(
    await http('/v1/chat/conversations', {
      method: 'POST',
      token: apiKey,
      body: {
        name: S + '-other',
        members: [{ userId: 'alice' }],
      },
    }),
    201,
    'other',
  );
  const m = must(
    await http(`/v1/chat/conversations/${other.publicId}/messages`, {
      method: 'POST',
      token: apiKey,
      body: { senderId: 'alice', text: 'secret' },
    }),
    201,
    'send',
  );
  let code = null;
  try {
    await bob.request('read.mark', { messageId: m.id });
  } catch (e) {
    code = e.code;
  }
  ok(code === 'PERMISSION_DENIED' || code === 'ROOM_NOT_FOUND', `refused (${code})`);
});

alice.close();
bob.close();
const res = summary('PHASE 6');
process.exit(res.failures.length ? 1 : 0);
