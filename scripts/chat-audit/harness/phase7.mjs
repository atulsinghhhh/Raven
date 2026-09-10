import { http, must, Client, sleep } from './lib.mjs';
import { test, note, eq, ok, summary } from './runner.mjs';
import ctx from './ctx.json' with { type: 'json' };
const { apiKey } = ctx;
const S = 'p7' + Date.now().toString(36);

console.log('\n########## PHASE 7 — REACTIONS ##########\n');
const conv = must(await http('/v1/chat/conversations', { method: 'POST', token: apiKey, body: {
  name: S, members: [{ userId: 'alice' }, { userId: 'bob' }, { userId: 'carol' }] } }), 201, 'conv');
const room = conv.publicId;
const grant = async (u) => must(await http('/v1/chat/tokens', { method: 'POST', token: apiKey, body: { userId: u, conversations: [room] } }), 201, u);
const ag = await grant('alice'), bg = await grant('bob'), cg = await grant('carol');
const alice = new Client(ag.token, 'alice'), bob = new Client(bg.token, 'bob'), carol = new Client(cg.token, 'carol');
for (const c of [alice, bob, carol]) { await c.connect(); await c.request('room.join', { room }); }
await sleep(200);

const ack = await alice.request('message.send', { room, text: 'react to me', clientMessageId: `${S}-1` });
const msgId = ack.message.id;

await test('Alice reacts 👍 → Bob receives reaction.added', async () => {
  bob.clear();
  const got = bob.waitFor((f) => f.type === 'reaction.added', 5000, 'reaction.added');
  const r = await alice.request('reaction.add', { messageId: msgId, emoji: '👍' });
  eq(r.reactions, [{ emoji: '👍', count: 1, userIds: ['alice'] }], 'summary in ack');
  const ev = await got;
  eq([ev.userId, ev.emoji, ev.messageId, ev.roomId], ['alice', '👍', msgId, room], 'event fields');
});

await test('reaction is persisted on the message', async () => {
  const m = must(await http(`/v1/chat/messages/${msgId}`, { token: apiKey }), 200, 'get');
  eq(m.reactions, [{ emoji: '👍', count: 1, userIds: ['alice'] }], 'persisted');
});

await test('duplicate add is idempotent — no second row, still an event', async () => {
  bob.clear();
  const r = await alice.request('reaction.add', { messageId: msgId, emoji: '👍' });
  eq(r.reactions, [{ emoji: '👍', count: 1, userIds: ['alice'] }], 'count still 1');
  await sleep(300);
  note(`events broadcast on duplicate add: ${bob.frames.filter((f) => f.type === 'reaction.added').length}`);
});

await test('multiple users, same emoji', async () => {
  await bob.request('reaction.add', { messageId: msgId, emoji: '👍' });
  await carol.request('reaction.add', { messageId: msgId, emoji: '👍' });
  const m = must(await http(`/v1/chat/messages/${msgId}`, { token: apiKey }), 200, 'get');
  eq(m.reactions[0].count, 3, 'three users');
  eq(m.reactions[0].userIds.sort(), ['alice', 'bob', 'carol'], 'all three named');
});

await test('multiple emojis on one message, sorted by count', async () => {
  await bob.request('reaction.add', { messageId: msgId, emoji: '🎉' });
  await carol.request('reaction.add', { messageId: msgId, emoji: '🎉' });
  await alice.request('reaction.add', { messageId: msgId, emoji: '🔥' });
  const m = must(await http(`/v1/chat/messages/${msgId}`, { token: apiKey }), 200, 'get');
  eq(m.reactions.map((r) => [r.emoji, r.count]), [['👍', 3], ['🎉', 2], ['🔥', 1]], 'grouped and sorted');
});

await test('Alice removes 👍 → Bob receives reaction.removed', async () => {
  bob.clear();
  const got = bob.waitFor((f) => f.type === 'reaction.removed', 5000, 'reaction.removed');
  const r = await alice.request('reaction.remove', { messageId: msgId, emoji: '👍' });
  const thumbs = r.reactions.find((x) => x.emoji === '👍');
  eq(thumbs.count, 2, 'count dropped to 2');
  ok(!thumbs.userIds.includes('alice'), 'alice removed');
  const ev = await got;
  eq([ev.userId, ev.emoji], ['alice', '👍'], 'event fields');
});

await test('same user toggling add/remove/add converges', async () => {
  await alice.request('reaction.add', { messageId: msgId, emoji: '👍' });
  await alice.request('reaction.remove', { messageId: msgId, emoji: '👍' });
  const r = await alice.request('reaction.add', { messageId: msgId, emoji: '👍' });
  eq(r.reactions.find((x) => x.emoji === '👍').count, 3, 'back to 3');
});

await test('removing a reaction that was never there succeeds (idempotent)', async () => {
  const r = await alice.request('reaction.remove', { messageId: msgId, emoji: '🦄' });
  ok(!r.reactions.some((x) => x.emoji === '🦄'), 'no unicorn');
});

await test('reacting to a nonexistent message → MESSAGE_NOT_FOUND', async () => {
  let code = null;
  try { await alice.request('reaction.add', { messageId: 'msg_doesnotexist', emoji: '👍' }); } catch (e) { code = e.code; }
  eq(code, 'MESSAGE_NOT_FOUND', 'not found');
});

await test('reacting to a deleted message is refused', async () => {
  const a = await alice.request('message.send', { room, text: 'delete me', clientMessageId: `${S}-del` });
  await alice.request('message.delete', { messageId: a.message.id });
  let code = null;
  try { await bob.request('reaction.add', { messageId: a.message.id, emoji: '👍' }); } catch (e) { code = e.code; }
  eq(code, 'MESSAGE_DELETED', 'refused');
});

await test('unauthorized user (non-member) cannot react', async () => {
  const mg = must(await http('/v1/chat/tokens', { method: 'POST', token: apiKey, body: { userId: 'mallory' } }), 201, 'mint mallory');
  const r = await http(`/v1/chat/messages/${msgId}/reactions`, { method: 'POST', token: mg.token, body: { emoji: '👍' } });
  ok([403,404].includes(r.status), `non-member reaction refused (${r.status}) — 404 now, so the message's existence is not confirmed`);
  const m = must(await http(`/v1/chat/messages/${msgId}`, { token: apiKey }), 200, 'get');
  ok(!m.reactions.some((x) => x.userIds.includes('mallory')), 'nothing written');
});

await test('read-only token cannot react', async () => {
  const ro = must(await http('/v1/chat/tokens', { method: 'POST', token: apiKey, body: { userId: 'bob', conversations: [room], scopes: ['chat:read'] } }), 201, 'ro');
  eq(ro.scopes, ['chat:read'], 'narrowed');
  const r = await http(`/v1/chat/messages/${msgId}/reactions`, { method: 'POST', token: ro.token, body: { emoji: '🚫' } });
  ok([403,404].includes(r.status), `read-only refused (${r.status})`);
});

await test('emoji length is bounded', async () => {
  let code = null;
  try { await alice.request('reaction.add', { messageId: msgId, emoji: 'x'.repeat(64) }); } catch (e) { code = e.code; }
  ok(code === 'INVALID_MESSAGE' || code === 'MESSAGE_TOO_LARGE', `bounded (${code})`);
});

await test('database consistency: one row per (message,user,emoji)', async () => {
  const m = must(await http(`/v1/chat/messages/${msgId}`, { token: apiKey }), 200, 'get');
  const pairs = m.reactions.flatMap((r) => r.userIds.map((u) => `${u}|${r.emoji}`));
  eq(pairs.length, new Set(pairs).size, 'no duplicate (user,emoji) pairs');
  note(JSON.stringify(m.reactions));
});

alice.close(); bob.close(); carol.close();
const res = summary('PHASE 7');
process.exit(res.failures.length ? 1 : 0);
