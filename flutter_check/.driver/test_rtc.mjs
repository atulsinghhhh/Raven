import { chromium } from 'playwright';
import { serve, makeRoom, rtcToken, waitForState, record, CHROME_ARGS, del } from './lib.mjs';

function url(port, params) {
  return `http://localhost:${port}/?` + new URLSearchParams(params).toString();
}

/** Real media proof: framesDecoded/bytesReceived must strictly increase. */
async function inboundStats(page) {
  return page.evaluate(async () => {
    const pcs = globalThis.__pcs ?? [];
    let frames = 0,
      bytes = 0,
      inbound = 0;
    for (const pc of pcs) {
      const stats = await pc.getStats();
      stats.forEach((r) => {
        if (r.type === 'inbound-rtp') {
          inbound++;
          frames += r.framesDecoded ?? 0;
          bytes += r.bytesReceived ?? 0;
        }
      });
    }
    return { frames, bytes, inbound, pcCount: pcs.length };
  });
}

// Flutter's webrtc goes through the browser's own RTCPeerConnection; hook the
// constructor before any app code runs so we can reach every pc for getStats.
const HOOK = `(() => { globalThis.__pcs = [];
  const Orig = globalThis.RTCPeerConnection;
  globalThis.RTCPeerConnection = function (...a) { const pc = new Orig(...a); globalThis.__pcs.push(pc); return pc; };
  globalThis.RTCPeerConnection.prototype = Orig.prototype;
  Object.assign(globalThis.RTCPeerConnection, Orig);
})();`;

const server = await serve('video', 8799);
const ts = Date.now();
const room = await makeRoom(`sdktest-rtc-${ts}`);
console.log(`\n### raven_rtc — room ${room.name} (${room.id})\n`);

const alice = await rtcToken(room.id, 'alice');
const bob = await rtcToken(room.id, 'bob');
const ice = JSON.stringify(alice.iceServers);

// Separate browser per participant: Chrome's fake camera is one shared
// resource per process (flutter_check/README.md).
const bA = await chromium.launch({ args: CHROME_ARGS });
const bB = await chromium.launch({ args: CHROME_ARGS });
const pA = await bA.newPage();
const pB = await bB.newPage();
for (const p of [pA, pB]) {
  await p.addInitScript(HOOK);
  p.on('console', (m) => {
    const t = m.text();
    if (t.includes('[flutter')) console.log(`    · ${t.slice(0, 160)}`);
  });
}

try {
  // ---- Alice joins and publishes first; Bob follows ~8s later. This is the
  // ordering the E2E report says breaks remote rendering on Web.
  await pA.goto(
    url(8799, { token: alice.token, endpoint: alice.endpoint, roomId: room.id, iceServers: ice, publish: 'true' }),
  );
  const sA = await waitForState(pA, (s) => s.ready === true || s.error, { label: 'alice ready', timeout: 60000 });
  record(
    'raven_rtc',
    'join() connects to the SFU',
    !sA.error && sA.connectionState === 'connected',
    sA.error ? JSON.stringify(sA.error) : `connectionState=${sA.connectionState}`,
  );
  record('raven_rtc', 'enableCamera() publishes', sA.cameraPublished === true, `cameraPublished=${sA.cameraPublished}`);
  record(
    'raven_rtc',
    'enableMicrophone() publishes',
    sA.microphonePublished === true,
    `microphonePublished=${sA.microphonePublished}`,
  );

  // Issue 5: local track must be visible before enableCamera() resolves.
  const seen = sA.localCameraFirstSeenAtMs,
    resolved = sA.enableCameraResolvedAtMs;
  record(
    'raven_rtc',
    'local preview notified before negotiation completes (0.1.8)',
    typeof seen === 'number' && typeof resolved === 'number' && seen <= resolved,
    `firstSeen=${seen}ms resolved=${resolved}ms`,
  );

  await new Promise((r) => setTimeout(r, 8000));

  await pB.goto(
    url(8799, { token: bob.token, endpoint: bob.endpoint, roomId: room.id, iceServers: ice, publish: 'true' }),
  );
  const sB = await waitForState(pB, (s) => s.ready === true || s.error, { label: 'bob ready', timeout: 60000 });
  record(
    'raven_rtc',
    'second participant joins a live room',
    !sB.error && sB.connectionState === 'connected',
    sB.error ? JSON.stringify(sB.error) : `connectionState=${sB.connectionState}`,
  );

  // ---- Roster + remote track visibility, both directions.
  // Wait for BOTH sources, not merely any: microphone lands before camera,
  // so a `.length > 0` predicate would race its own assertion.
  const both = (s, who) => {
    const v = s.remoteLiveSources?.[who] ?? [];
    return v.includes('camera') && v.includes('microphone');
  };
  const aSeesB = await waitForState(pA, (s) => both(s, 'bob'), {
    label: 'alice sees bob camera+mic',
    timeout: 40000,
  }).catch((e) => ({ _err: e.message }));
  const bSeesA = await waitForState(pB, (s) => both(s, 'alice'), {
    label: 'bob sees alice camera+mic',
    timeout: 40000,
  }).catch((e) => ({ _err: e.message }));
  const aSrc = aSeesB._err ? [] : (aSeesB.remoteLiveSources?.bob ?? []);
  const bSrc = bSeesA._err ? [] : (bSeesA.remoteLiveSources?.alice ?? []);
  record(
    'raven_rtc',
    'first joiner sees second joiner tracks (engine)',
    aSrc.includes('camera') && aSrc.includes('microphone'),
    `alice.remoteLiveSources.bob=${JSON.stringify(aSrc)}`,
  );
  record(
    'raven_rtc',
    'second joiner sees first joiner tracks (engine)',
    bSrc.includes('camera') && bSrc.includes('microphone'),
    `bob.remoteLiveSources.alice=${JSON.stringify(bSrc)}`,
  );

  // ---- Real media, not just signaling: two samples several seconds apart.
  await new Promise((r) => setTimeout(r, 6000));
  const a1 = await inboundStats(pA),
    b1 = await inboundStats(pB);
  await new Promise((r) => setTimeout(r, 6000));
  const a2 = await inboundStats(pA),
    b2 = await inboundStats(pB);
  record(
    'raven_rtc',
    'alice decodes real media from bob',
    a2.frames > a1.frames && a2.bytes > a1.bytes,
    `frames ${a1.frames}->${a2.frames}, bytes ${a1.bytes}->${a2.bytes}`,
  );
  record(
    'raven_rtc',
    'bob decodes real media from alice',
    b2.frames > b1.frames && b2.bytes > b1.bytes,
    `frames ${b1.frames}->${b2.frames}, bytes ${b1.bytes}->${b2.bytes}`,
  );

  // ---- Leave. The harness exposes room.leave() as window.__leave; the
  // observable effect is bob's roster losing alice.
  const hasLeave = await pA.evaluate(() => typeof globalThis.__leave === 'function');
  await pA.evaluate(() => globalThis.__leave());
  const gone = await waitForState(pB, (s) => !(s.remoteLiveSources ?? {}).alice, {
    label: 'bob sees alice depart',
    timeout: 30000,
  }).catch((e) => ({ _err: e.message }));
  record(
    'raven_rtc',
    'leave() removes the participant from the remote roster',
    hasLeave && !gone._err,
    gone._err ? gone._err.slice(0, 120) : 'bob.remoteLiveSources no longer lists alice',
  );
} finally {
  await bA.close();
  await bB.close();
  server.close();
  await del(`/v1/rooms/${room.id}`).catch(() => {});
}
