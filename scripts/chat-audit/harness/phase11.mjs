import { http, must, Client, sleep } from './lib.mjs';
import { test, note, eq, ok, summary } from './runner.mjs';
import ctx from './ctx.json' with { type: 'json' };
import { execSync } from 'child_process';
const { apiKey } = ctx;
const S = 'p11' + Date.now().toString(36);
const redis = (cmd) => execSync(`docker exec raven-chat-audit-redis redis-cli ${cmd}`).toString().trim();
/** Runs SQL via a file so quoted identifiers survive the shell. */
const pg = (sql) => {
  const f = `/tmp/audit-p11-${Math.random().toString(36).slice(2)}.sql`;
  execSync(`cat > ${f} <<'RAVENSQL'\n${sql}\nRAVENSQL`, { shell: '/bin/bash' });
  execSync(`docker cp ${f} raven-e2e-pg:/tmp/q11.sql`);
  const out = execSync(`docker exec raven-e2e-pg psql -U postgres -d postgres -tAf /tmp/q11.sql`).toString().trim();
  execSync(`rm -f ${f}`);
  return out;
};

console.log('\n########## PHASE 11 — DATABASE / REDIS ##########\n');
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
    await http('/v1/chat/tokens', {
      method: 'POST',
      token: apiKey,
      body: { userId: u, conversations: [room], ttlSeconds: 21600 },
    }),
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
alice.send({ type: 'typing.start', room });
await sleep(400);

const sentIds = [];
for (let i = 0; i < 20; i++)
  sentIds.push(
    (await alice.request('message.send', { room, text: `pre-restart-${i}`, clientMessageId: `${S}-${i}` })).message.id,
  );
await alice.request('reaction.add', { messageId: sentIds[0], emoji: '👍' });
await bob.request('read.mark', { messageId: sentIds[10] });
await sleep(300);

await test('Redis holds ONLY ephemeral/realtime state, and every key has a TTL', async () => {
  const keys = redis('--scan --count 20000').split('\n').filter(Boolean);
  const namespaces = [...new Set(keys.map((k) => k.split(':').slice(0, 3).join(':')))].sort();
  note(`namespaces: ${JSON.stringify(namespaces)}`);
  // One TTL round trip for the whole keyspace, not one per key.
  const ttlScript = keys.map((k) => `ttl ${k}`).join('\n');
  const ttlOut = execSync(`docker exec -i raven-chat-audit-redis redis-cli`, { input: ttlScript })
    .toString()
    .trim()
    .split('\n');
  const noTtl = keys.filter((_, i) => ttlOut[i] === '-1');
  eq(noTtl, [], `no key without a TTL (checked ${keys.length})`);
  const durable = keys.filter(
    (k) => /message|conversation|member|readstate|read_state/i.test(k) && !/idem|metrics/.test(k),
  );
  eq(durable, [], 'no message/conversation/member/read-state records in Redis');
  ok(
    keys.some((k) => k.startsWith('raven:presence:')),
    'presence is in Redis',
  );
  ok(
    keys.some((k) => k.startsWith('raven:typing:')),
    'typing is in Redis',
  );
  ok(
    keys.some((k) => k.startsWith('raven:chat:conn:')),
    'connection routing is in Redis',
  );
});

await test('message bodies are never written to Redis', async () => {
  const keys = redis('--scan --count 5000').split('\n').filter(Boolean);
  // Dump every value in one round trip and search the lot.
  const script = keys
    .flatMap((k) => [`type ${k}`, `get ${k}`, `hgetall ${k}`, `smembers ${k}`, `zrange ${k} 0 -1`])
    .join('\n');
  const dump = execSync(`docker exec -i raven-chat-audit-redis redis-cli`, { input: script }).toString();
  ok(!dump.includes('pre-restart-'), 'no message text found anywhere in Redis');
  note(`scanned ${keys.length} keys`);
});

await test('FLUSH Redis (simulating total loss of ephemeral state) — chat history survives', async () => {
  redis('flushall');
  eq(redis('dbsize'), '0', 'redis emptied');
  await sleep(500);
  const page = must(await http(`/v1/chat/conversations/${room}/messages?limit=100`, { token: apiKey }), 200, 'h');
  eq(page.data.length, 20, 'all 20 messages still readable from Postgres');
  eq(page.data.map((m) => m.id).sort(), [...sentIds].sort(), 'exact same ids');
  const m = must(await http(`/v1/chat/messages/${sentIds[0]}`, { token: apiKey }), 200, 'm');
  eq(m.reactions, [{ emoji: '👍', count: 1, userIds: ['alice'] }], 'reactions survived');
  const rs = must(await http(`/v1/chat/conversations/${room}/read-state`, { token: bg.token }), 200, 'rs');
  eq(rs.lastReadMessageId, sentIds[10], 'read state survived');
  const members = must(await http(`/v1/chat/conversations/${room}/members`, { token: apiKey }), 200, 'mm');
  eq(members.map((x) => x.userId).sort(), ['alice', 'bob'], 'membership survived');
});

await test('RESTART Redis entirely — chat history still survives', async () => {
  execSync('docker restart raven-chat-audit-redis', { stdio: 'ignore' });
  for (let i = 0; i < 40; i++) {
    try {
      redis('ping');
      break;
    } catch {
      await sleep(500);
    }
  }
  await sleep(2000);
  const page = must(await http(`/v1/chat/conversations/${room}/messages?limit=100`, { token: apiKey }), 200, 'h');
  eq(page.data.length, 20, 'history intact after a Redis restart');
});

await test('chat keeps working after Redis comes back (new sends, new fan-out)', async () => {
  // Existing sockets may be stale after the restart; reconnect as a client would.
  alice.close();
  bob.close();
  await sleep(500);
  alice = new Client(ag.token, 'alice2');
  bob = new Client(bg.token, 'bob2');
  await alice.connect();
  await bob.connect();
  await alice.request('room.join', { room });
  await bob.request('room.join', { room });
  await sleep(400);
  bob.clear();
  const ack = await alice.request('message.send', { room, text: 'post-redis-restart', clientMessageId: `${S}-post` });
  const f = await bob.waitFor((x) => x.type === 'message', 8000, 'fanout after redis restart');
  eq(f.message.id, ack.message.id, 'fan-out works again');
  const page = must(await http(`/v1/chat/conversations/${room}/messages?limit=100`, { token: apiKey }), 200, 'h');
  eq(page.data.length, 21, '21 messages persisted');
});

await test('presence/typing correctly rebuild after the Redis restart', async () => {
  const p = must(await http(`/v1/chat/conversations/${room}/presence`, { token: apiKey }), 200, 'p');
  eq(p.map((x) => x.userId).sort(), ['alice', 'bob'], 'presence rebuilt from live sockets');
  const t = must(await http(`/v1/chat/conversations/${room}/typing`, { token: apiKey }), 200, 't');
  eq(t.userIds, [], 'stale typing did NOT survive the restart — correct, it is ephemeral');
});

await test('idempotency still holds after the Redis cache was wiped (DB constraint is the real guarantee)', async () => {
  const again = await alice.request('message.send', { room, text: `pre-restart-0`, clientMessageId: `${S}-0` });
  eq(again.deduplicated, true, 'deduplicated by the Postgres unique index, not the Redis cache');
  eq(again.message.id, sentIds[0], 'same original id');
});

await test('cascade: deleting a conversation removes its messages/members/reactions/read-states', async () => {
  const tmp = must(
    await http('/v1/chat/conversations', {
      method: 'POST',
      token: apiKey,
      body: {
        name: S + '-cascade',
        members: [{ userId: 'alice' }],
      },
    }),
    201,
    'tmp',
  );
  const msg = must(
    await http(`/v1/chat/conversations/${tmp.publicId}/messages`, {
      method: 'POST',
      token: apiKey,
      body: { senderId: 'alice', text: 'doomed' },
    }),
    201,
    'send',
  );
  // A server actor has no identity of its own, so reacting and marking read
  // need a chat token — correct behaviour, not a workaround.
  const cg = must(
    await http('/v1/chat/tokens', {
      method: 'POST',
      token: apiKey,
      body: { userId: 'alice', conversations: [tmp.publicId] },
    }),
    201,
    'mint',
  );
  must(
    await http(`/v1/chat/messages/${msg.id}/reactions`, { method: 'POST', token: cg.token, body: { emoji: '💥' } }),
    201,
    'react',
  );
  must(await http(`/v1/chat/messages/${msg.id}/read`, { method: 'POST', token: cg.token, body: {} }), 201, 'read');

  // The API only ever speaks public ids now, so resolve the uuid here.
  const uuid = pg(`SELECT id FROM chat_conversations WHERE "publicId" = '${tmp.publicId}'`);
  ok(/^[0-9a-f-]{36}$/.test(uuid), `resolved internal uuid for ${tmp.publicId}`);
  eq(pg(`SELECT count(*) FROM chat_messages WHERE "conversationId" = '${uuid}'`), '1', 'message present');
  eq(pg(`SELECT count(*) FROM chat_reactions WHERE "conversationId" = '${uuid}'`), '1', 'reaction present');

  pg(`DELETE FROM chat_conversations WHERE id = '${uuid}'`);

  eq(pg(`SELECT count(*) FROM chat_messages WHERE "conversationId" = '${uuid}'`), '0', 'messages cascaded');
  eq(pg(`SELECT count(*) FROM chat_members WHERE "conversationId" = '${uuid}'`), '0', 'members cascaded');
  eq(pg(`SELECT count(*) FROM chat_reactions WHERE "conversationId" = '${uuid}'`), '0', 'reactions cascaded');
  eq(pg(`SELECT count(*) FROM chat_read_states WHERE "conversationId" = '${uuid}'`), '0', 'read states cascaded');
  note(`deleted conversation ${tmp.publicId} (${uuid}), message ${msg.id}`);
});
await test('unique constraints are real, not advisory', async () => {
  const dup = execSync(
    `docker exec raven-e2e-pg psql -U postgres -d postgres -tAc "INSERT INTO chat_members (id,\\"conversationId\\",\\"projectId\\",\\"userId\\",role,status,\\"joinedAt\\") SELECT gen_random_uuid(), \\"conversationId\\",\\"projectId\\",\\"userId\\",role,status,\\"joinedAt\\" FROM chat_members LIMIT 1" 2>&1 || true`,
  ).toString();
  ok(
    /duplicate key|unique constraint/i.test(dup),
    `duplicate membership rejected by the DB: ${dup.trim().split('\n')[0]}`,
  );
});

alice.close();
bob.close();
const res = summary('PHASE 11');
process.exit(res.failures.length ? 1 : 0);
