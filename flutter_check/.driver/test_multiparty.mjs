import { chromium } from 'playwright';
import { serve, makeRoom, rtcToken, waitForState, record, CHROME_ARGS, del, summarize } from './lib.mjs';

const url = (port, params) => `http://localhost:${port}/?` + new URLSearchParams(params).toString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NAMES = ['alice', 'bob', 'carol', 'dave', 'erin'].slice(0, Number(process.env.N ?? 5));

const HOOK = `(() => { globalThis.__pcs = [];
  const O = globalThis.RTCPeerConnection;
  globalThis.RTCPeerConnection = function (...a) { const pc = new O(...a); globalThis.__pcs.push(pc); return pc; };
  globalThis.RTCPeerConnection.prototype = O.prototype; Object.assign(globalThis.RTCPeerConnection, O); })();`;

async function inbound(page) {
  return page.evaluate(async () => {
    let frames = 0,
      bytes = 0,
      streams = 0;
    for (const pc of globalThis.__pcs ?? []) {
      (await pc.getStats()).forEach((r) => {
        if (r.type === 'inbound-rtp') {
          streams++;
          frames += r.framesDecoded ?? 0;
          bytes += r.bytesReceived ?? 0;
        }
      });
    }
    return { frames, bytes, streams };
  });
}

const server = await serve('video', 8804);
const room = await makeRoom(`sdktest-multi-${Date.now()}`);
console.log(`\n### raven_rtc multiparty — ${NAMES.length} publishers, room ${room.name}\n`);

const tokens = {};
for (const n of NAMES) tokens[n] = await rtcToken(room.id, n);
const ice = JSON.stringify(tokens.alice.iceServers);

// One browser process per participant: Chrome's fake camera is a single
// shared device per process (flutter_check/README.md).
const browsers = [],
  pages = {};
try {
  for (const n of NAMES) {
    const b = await chromium.launch({ args: CHROME_ARGS });
    browsers.push(b);
    const p = await b.newPage();
    await p.addInitScript(HOOK);
    p.on('pageerror', (e) => console.log(`  [${n}] PAGEERROR`, String(e).slice(0, 140)));
    pages[n] = p;
  }

  // Staggered joins — each newcomer arrives into a progressively busier room,
  // which is what exercises the roster-replay path (the 0.1.6 fix).
  for (const n of NAMES) {
    const t = tokens[n];
    await pages[n].goto(
      url(8804, { token: t.token, endpoint: t.endpoint, roomId: room.id, iceServers: ice, publish: 'true' }),
    );
    const s = await waitForState(pages[n], (x) => x.ready === true || x.error, { label: `${n} ready`, timeout: 90000 });
    record(
      'multiparty',
      `${n} joins and publishes`,
      !s.error && s.cameraPublished === true && s.microphonePublished === true,
      s.error
        ? JSON.stringify(s.error).slice(0, 110)
        : `state=${s.connectionState} cam=${s.cameraPublished} mic=${s.microphonePublished}`,
    );
    await sleep(Number(process.env.JOIN_GAP_MS ?? 3000));
  }

  // Full mesh: every participant must see every other one's camera AND mic.
  console.log('\n  -- roster convergence --');
  await sleep(5000);
  const expectedPeers = NAMES.length - 1;
  for (const n of NAMES) {
    const others = NAMES.filter((o) => o !== n);
    const ok = await waitForState(
      pages[n],
      (s) =>
        others.every((o) => {
          const v = s.remoteLiveSources?.[o] ?? [];
          return v.includes('camera') && v.includes('microphone');
        }),
      { label: `${n} sees all ${expectedPeers} peers`, timeout: 60000 },
    ).catch((e) => ({ _err: e.message }));
    if (ok._err) {
      const s = await pages[n].evaluate(() => globalThis.__state?.remoteLiveSources ?? {});
      const missing = others.filter((o) => {
        const v = s[o] ?? [];
        return !(v.includes('camera') && v.includes('microphone'));
      });
      record(
        'multiparty',
        `${n} sees all ${expectedPeers} other publishers`,
        false,
        `missing/incomplete: ${JSON.stringify(missing)} — got ${JSON.stringify(s)}`.slice(0, 220),
      );
    } else {
      record(
        'multiparty',
        `${n} sees all ${expectedPeers} other publishers`,
        true,
        `camera+mic from ${others.join(', ')}`,
      );
    }
  }

  // Real media for everyone, not just signaling.
  console.log('\n  -- media flow --');
  const first = {};
  for (const n of NAMES) first[n] = await inbound(pages[n]);
  await sleep(8000);
  for (const n of NAMES) {
    const now = await inbound(pages[n]);
    const grew = now.frames > first[n].frames && now.bytes > first[n].bytes;
    record(
      'multiparty',
      `${n} decodes live media from the room`,
      grew,
      `inbound streams=${now.streams}, frames ${first[n].frames}->${now.frames}, bytes ${first[n].bytes}->${now.bytes}`,
    );
  }

  // Departure propagates to everyone still in the room.
  console.log('\n  -- departure --');
  await pages.erin.evaluate(() => globalThis.__leave());
  const remaining = NAMES.filter((n) => n !== 'erin');
  for (const n of remaining) {
    const gone = await waitForState(pages[n], (s) => !(s.remoteLiveSources ?? {}).erin, {
      label: `${n} drops erin`,
      timeout: 40000,
    }).catch((e) => ({ _err: e.message }));
    record('multiparty', `${n} sees erin leave`, !gone._err, gone._err ? 'erin still listed' : 'roster updated');
  }
} finally {
  for (const b of browsers) await b.close().catch(() => {});
  server.close();
  await del(`/v1/rooms/${room.id}`).catch(() => {});
}
process.exit(summarize() > 0 ? 1 : 0);
