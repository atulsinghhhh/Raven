import { http, must, Client, sleep } from './lib.mjs';
import ctx from './ctx.json' with { type: 'json' };
const { apiKey } = ctx;
const S = 'perf' + Date.now().toString(36);
const pct = (a, p) => a.slice().sort((x, y) => x - y)[Math.floor(a.length * p)];

const room = must(
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
).publicId;
const g = async (u) =>
  must(
    await http('/v1/chat/tokens', {
      method: 'POST',
      token: apiKey,
      body: { userId: u, conversations: [room], ttlSeconds: 21600 },
    }),
    201,
    u,
  );
const ag = await g('alice'),
  bg = await g('bob');
const a = new Client(ag.token, 'a'),
  b = new Client(bg.token, 'b');
await a.connect();
await b.connect();
await a.request('room.join', { room });
await b.request('room.join', { room });
await sleep(200);

// 1. Frame size
let frameBytes = 0,
  cursorBytes = 0,
  n = 0;
b.ws.on('message', (raw) => {
  const f = JSON.parse(raw.toString());
  if (f.type === 'message') {
    frameBytes += raw.length;
    cursorBytes += (f.message.cursor ?? '').length + '"cursor":,'.length;
    n++;
  }
});

// 2. Send throughput + persist latency
const persist = [];
const t0 = Date.now();
for (let i = 0; i < 500; i++) {
  const ack = await a.request('message.send', { room, text: `perf-${i}`, clientMessageId: `${S}-${i}` }, 20000);
  persist.push(ack.persistLatencyMs);
}
const wall = Date.now() - t0;
for (let i = 0; i < 50 && n < 500; i++) await sleep(100);

console.log('--- steady state (500 messages, 1 sender, 1 receiver) ---');
console.log(`  throughput          ${(500 / (wall / 1000)).toFixed(1)} msg/s`);
console.log(`  persist p50/p95/max ${pct(persist, 0.5)} / ${pct(persist, 0.95)} / ${Math.max(...persist)} ms`);
console.log(`  mean frame          ${(frameBytes / n).toFixed(0)} bytes`);
console.log(
  `  of which cursor     ${(cursorBytes / n).toFixed(0)} bytes (${((100 * cursorBytes) / frameBytes).toFixed(1)}%)`,
);

// 3. Cost of the catch-up call itself
const one = must(await http(`/v1/chat/conversations/${room}/messages?limit=1`, { token: ag.token }), 200, 'c');
const cursor = one.data[0].cursor;
const timeIt = async (qs, runs = 12) => {
  const s = [];
  for (let i = 0; i < runs; i++) {
    const t = Date.now();
    must(await http(`/v1/chat/conversations/${room}/messages?${qs}`, { token: ag.token }), 200, 'q');
    s.push(Date.now() - t);
  }
  return pct(s, 0.5);
};
console.log('\n--- catch-up request cost (chat token) ---');
console.log(`  nothing missed (empty page)  ${await timeIt(`limit=100&after=${encodeURIComponent(cursor)}`)} ms`);
// Walk back to a point ~100 messages behind the head.
let back = must(await http(`/v1/chat/conversations/${room}/messages?limit=100`, { token: ag.token }), 200, 'o');
back = must(
  await http(`/v1/chat/conversations/${room}/messages?limit=100&before=${encodeURIComponent(back.nextCursor)}`, {
    token: ag.token,
  }),
  200,
  'o2',
);
const oldest = back.data[back.data.length - 1].cursor;
console.log(`  full page of 100 missed      ${await timeIt(`limit=100&after=${encodeURIComponent(oldest)}`)} ms`);
a.close();
b.close();
process.exit(0);
