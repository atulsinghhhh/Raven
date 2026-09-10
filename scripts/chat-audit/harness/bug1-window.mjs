import { http, must, Client, sleep } from './lib.mjs';
import ctx from './ctx.json' with { type: 'json' };
const { apiKey } = ctx;
const S = 'bug1w' + Date.now().toString(36);
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
const presence = async () => must(await http(`/v1/chat/conversations/${room}/presence`, { token: apiKey }), 200, 'p');

const bob = new Client(bg.token, 'bob');
await bob.connect();
await bob.request('room.join', { room });
for (let trial = 1; trial <= 3; trial++) {
  const a1 = new Client(ag.token, 'a1');
  await a1.connect();
  await a1.request('room.join', { room });
  const a2 = new Client(ag.token, 'a2');
  await a2.connect();
  await a2.request('room.join', { room });
  await sleep(400);
  bob.clear();
  const t0 = Date.now();
  a1.close();
  let offlineAt = null,
    onlineAt = null;
  while (Date.now() - t0 < 30000) {
    const evs = bob.frames.filter((f) => f.type === 'presence' && f.userId === 'alice');
    if (!offlineAt && evs.some((e) => e.status === 'offline')) offlineAt = Date.now() - t0;
    if (offlineAt !== null && !onlineAt && evs.some((e) => e.status === 'online')) {
      onlineAt = Date.now() - t0;
      break;
    }
    await sleep(100);
  }
  const p = await presence();
  console.log(
    `trial ${trial}: spurious offline at +${offlineAt}ms, recovered online at +${onlineAt ?? '>30000'}ms  (false-offline window ≈ ${onlineAt !== null ? onlineAt - offlineAt : '>30000'}ms) final=${JSON.stringify(p.map((x) => x.userId + ':' + x.status))}`,
  );
  a2.close();
  await sleep(1200);
}
bob.close();
process.exit(0);
