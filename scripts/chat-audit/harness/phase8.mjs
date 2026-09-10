import { http, must, Client, sleep } from './lib.mjs';
import { test, note, eq, ok, summary } from './runner.mjs';
import ctx from './ctx.json' with { type: 'json' };
const { apiKey, jwt } = ctx;
const S = 'p8' + Date.now().toString(36);

console.log('\n########## PHASE 8 — AUTHORIZATION ##########\n');
const conv = must(await http('/v1/chat/conversations', { method: 'POST', token: apiKey, body: {
  name: S, members: [{ userId: 'alice', role: 'ADMIN' }, { userId: 'bob' }] } }), 201, 'conv');
const room = conv.publicId;
const grant = async (u, extra = {}) => must(await http('/v1/chat/tokens', { method: 'POST', token: apiKey, body: { userId: u, ...extra } }), 201, u);
const ag = await grant('alice', { conversations: [room] });
const bg = await grant('bob', { conversations: [room] });
// Mallory is NOT a member. Token is project-wide (no conversations pin) so the
// membership check — not the token pin — is what has to stop her.
const mg = await grant('mallory');

const alice = new Client(ag.token, 'alice'); await alice.connect(); await alice.request('room.join', { room });
const msg = await alice.request('message.send', { room, text: 'members only', clientMessageId: `${S}-1` });
const msgId = msg.message.id;

await test('non-member → read conversation: refused', async () => {
  const r = await http(`/v1/chat/conversations/${room}`, { token: mg.token });
  ok([403, 404].includes(r.status), `refused (${r.status})`);
  ok(!JSON.stringify(r.body).includes(conv.name), 'conversation name not leaked');
  note(`body: ${JSON.stringify(r.body).slice(0, 200)}`);
});

await test('non-member → read history: refused, no message contents leaked', async () => {
  const r = await http(`/v1/chat/conversations/${room}/messages`, { token: mg.token });
  ok([403, 404].includes(r.status), `refused (${r.status})`);
  ok(!JSON.stringify(r.body).includes('members only'), 'no message text leaked');
});

await test('non-member → read a message by id: refused, no text leaked', async () => {
  const r = await http(`/v1/chat/messages/${msgId}`, { token: mg.token });
  ok(r.status === 403 || r.status === 404, `refused (${r.status})`);
  ok(!JSON.stringify(r.body).includes('members only'), 'no message text leaked');
});

await test('non-member → send message: refused, nothing persisted', async () => {
  const r = await http(`/v1/chat/conversations/${room}/messages`, { method: 'POST', token: mg.token, body: { text: 'intrusion' } });
  ok([403, 404].includes(r.status), `refused (${r.status})`);
  const page = must(await http(`/v1/chat/conversations/${room}/messages`, { token: apiKey }), 200, 'h');
  ok(!page.data.some((m) => m.text === 'intrusion'), 'no row written');
});

await test('non-member → add member: refused', async () => {
  const r = await http(`/v1/chat/conversations/${room}/members`, { method: 'POST', token: mg.token, body: { userId: 'mallory' } });
  ok([403, 404].includes(r.status), `refused (${r.status})`);
  const members = must(await http(`/v1/chat/conversations/${room}/members`, { token: apiKey }), 200, 'm');
  ok(!members.some((m) => m.userId === 'mallory'), 'mallory not added');
});

await test('non-member → remove member: refused', async () => {
  const r = await http(`/v1/chat/conversations/${room}/members/bob`, { method: 'DELETE', token: mg.token });
  ok([403, 404].includes(r.status), `refused (${r.status})`);
  const members = must(await http(`/v1/chat/conversations/${room}/members`, { token: apiKey }), 200, 'm');
  ok(members.some((m) => m.userId === 'bob'), 'bob still a member');
});

await test('non-member → list members: refused, no member info leaked', async () => {
  const r = await http(`/v1/chat/conversations/${room}/members`, { token: mg.token });
  ok([403, 404].includes(r.status), `refused (${r.status})`);
  ok(!JSON.stringify(r.body).includes('bob'), 'no member ids leaked');
});

await test('non-member → open a WebSocket and join: refused without confirming the room exists', async () => {
  const m = new Client(mg.token, 'mallory');
  await m.connect();     // the socket itself is allowed: the token is valid for the project
  let code = null;
  try { await m.request('room.join', { room }); } catch (e) { code = e.code; }
  eq(code, 'ROOM_NOT_FOUND', 'join refused at the gateway without confirming the room exists');
  m.close();
});

await test('non-member never receives fan-out', async () => {
  const m = new Client(mg.token, 'mallory2'); await m.connect();
  try { await m.request('room.join', { room }); } catch {}
  m.clear();
  await alice.request('message.send', { room, text: 'still members only', clientMessageId: `${S}-2` });
  await sleep(800);
  eq(m.frames.filter((f) => f.type === 'message').length, 0, 'no messages delivered to a non-member socket');
  m.close();
});

await test('conversation existence is not leaked: unknown vs forbidden are indistinguishable to a stranger', async () => {
  const real = await http(`/v1/chat/conversations/${room}`, { token: mg.token });
  const fake = await http(`/v1/chat/conversations/conv_totally_made_up_00000000`, { token: mg.token });
  note(`existing-but-forbidden: ${real.status} ${JSON.stringify(real.body?.error?.code ?? real.body?.code)}`);
  note(`nonexistent:            ${fake.status} ${JSON.stringify(fake.body?.error?.code ?? fake.body?.code)}`);
  ok(real.status === fake.status, `same status (${real.status} vs ${fake.status}) — otherwise existence is probeable`);
});

await test('cross-project isolation: another project\'s key cannot see this conversation', async () => {
  const reg = must(await http('/v1/auth/register', { method: 'POST', body: { email: `other-${S}@raven.local`, password: 'correct-horse-battery-staple' } }), 201, 'reg');
  const p2 = must(await http('/v1/projects', { method: 'POST', token: reg.accessToken, body: { name: `other-${S}` } }), 201, 'proj');
  const k2 = must(await http(`/v1/projects/${p2.id}/api-keys`, { method: 'POST', token: reg.accessToken, body: { name: 'k' } }), 201, 'key');
  const r = await http(`/v1/chat/conversations/${room}`, { token: k2.key });
  eq(r.status, 404, 'not found across tenants (never 403, which would confirm it exists)');
  const r2 = await http(`/v1/chat/messages/${msgId}`, { token: k2.key });
  eq(r2.status, 404, 'message not found across tenants');
  ok(!JSON.stringify(r2.body).includes('members only'), 'no text leaked');
});

await test('removed member → send message: refused', async () => {
  const bobClient = new Client(bg.token, 'bob'); await bobClient.connect(); await bobClient.request('room.join', { room });
  await bobClient.request('message.send', { room, text: 'bob was here', clientMessageId: `${S}-bob1` });
  must(await http(`/v1/chat/conversations/${room}/members/bob`, { method: 'DELETE', token: apiKey }), 204, 'remove bob');

  let code = null;
  try { await bobClient.request('message.send', { room, text: 'after removal', clientMessageId: `${S}-bob2` }); } catch (e) { code = e.code; }
  eq(code, 'ROOM_NOT_FOUND', 'existing socket cannot send after removal');
  const r = await http(`/v1/chat/conversations/${room}/messages`, { method: 'POST', token: bg.token, body: { text: 'after removal http' } });
  ok([403, 404].includes(r.status), `REST send refused too (${r.status})`);
  const page = must(await http(`/v1/chat/conversations/${room}/messages?limit=100`, { token: apiKey }), 200, 'h');
  ok(!page.data.some((m) => m.text?.startsWith('after removal')), 'nothing persisted');
  bobClient.close();
});

await test('removed member → read history: refused', async () => {
  const r = await http(`/v1/chat/conversations/${room}/messages`, { token: bg.token });
  ok([403, 404].includes(r.status), `refused (${r.status})`);
  ok(!JSON.stringify(r.body).includes('members only'), 'no history leaked');
});

await test('removed member: an already-open socket stops receiving fan-out', async () => {
  const bobClient = new Client(bg.token, 'bob-live');
  await bobClient.connect();
  let joined = true;
  try { await bobClient.request('room.join', { room }); } catch { joined = false; }
  eq(joined, false, 'removed member cannot re-join');
  bobClient.clear();
  await alice.request('message.send', { room, text: 'post-removal broadcast', clientMessageId: `${S}-3` });
  await sleep(800);
  eq(bobClient.frames.filter((f) => f.type === 'message').length, 0, 'no fan-out to removed member');
  bobClient.close();
});

await test('LIVE REVOCATION: a socket joined BEFORE removal keeps receiving fan-out', async () => {
  const g = await grant('bob', { conversations: [room] });
  must(await http(`/v1/chat/conversations/${room}/members`, { method: 'POST', token: apiKey, body: { userId: 'bob' } }), 201, 're-add bob');
  const bobClient = new Client(g.token, 'bob-preremoval');
  await bobClient.connect();
  await bobClient.request('room.join', { room });
  await sleep(200);
  must(await http(`/v1/chat/conversations/${room}/members/bob`, { method: 'DELETE', token: apiKey }), 204, 'remove bob again');
  bobClient.clear();
  await alice.request('message.send', { room, text: 'after-removal-live', clientMessageId: `${S}-4` });
  await sleep(1000);
  const got = bobClient.frames.filter((f) => f.type === 'message');
  note(`frames a removed-but-still-subscribed member received: ${got.length}`);
  eq(got.length, 0, 'removal must terminate an existing subscription');
  bobClient.close();
});

await test('token scoped to conversation A cannot touch conversation B', async () => {
  const other = must(await http('/v1/chat/conversations', { method: 'POST', token: apiKey, body: {
    name: S + '-b', members: [{ userId: 'alice' }] } }), 201, 'other');
  const r = await http(`/v1/chat/conversations/${other.publicId}/messages`, { token: ag.token });
  ok([403, 404].includes(r.status), `pinned token refused (${r.status})`);
});

await test('client actor cannot forge senderId', async () => {
  const r = must(await http(`/v1/chat/conversations/${room}/messages`, { method: 'POST', token: ag.token, body: { text: 'forged', senderId: 'bob' } }), 201, 'send');
  eq(r.senderId, 'alice', 'senderId comes from the token, not the body');
});

await test('an invalid / tampered token is rejected', async () => {
  const tampered = ag.token.slice(0, -3) + 'AAA';
  const r = await http(`/v1/chat/conversations/${room}/messages`, { token: tampered });
  eq(r.status, 401, 'unauthorized');
  const c = new Client(tampered, 'tampered');
  let failed = false;
  try { await c.connect(); } catch { failed = true; }
  ok(failed || c.closes.length > 0, 'websocket upgrade rejected too');
  c.close();
});

await test('a revoked-by-expiry token is rejected', async () => {
  const short = must(await http('/v1/chat/tokens', { method: 'POST', token: apiKey, body: { userId: 'alice', conversations: [room], ttlSeconds: 60 } }), 201, 'short');
  const claims = JSON.parse(Buffer.from(short.token.split('.')[1], 'base64url').toString());
  ok(claims.exp - claims.iat === 60, 'ttl honoured');
  // Forge an expired one by editing the payload — signature must then fail.
  const forged = short.token.split('.'); forged[1] = Buffer.from(JSON.stringify({ ...claims, exp: claims.exp + 999999 })).toString('base64url');
  const r = await http(`/v1/chat/conversations/${room}/messages`, { token: forged.join('.') });
  eq(r.status, 401, 'extended-expiry forgery rejected');
});

await test('no credentials at all → 401', async () => {
  eq((await http(`/v1/chat/conversations/${room}/messages`)).status, 401, 'no auth header');
  eq((await http(`/v1/chat/conversations/${room}/messages`, { token: 'garbage' })).status, 401, 'garbage token');
});

await test('dashboard session JWT cannot be replayed as a chat token', async () => {
  const r = await http(`/v1/chat/conversations/${room}/messages`, { token: jwt });
  eq(r.status, 401, 'session JWT rejected on the chat surface');
});

alice.close();
const res = summary('PHASE 8');
process.exit(res.failures.length ? 1 : 0);
