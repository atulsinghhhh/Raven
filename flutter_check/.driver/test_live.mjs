import { chromium } from 'playwright';
import { serve, post, waitForState, record, CHROME_ARGS } from './lib.mjs';

const url = (port, creds) => `http://localhost:${port}/?creds=${encodeURIComponent(JSON.stringify(creds))}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function inboundStats(page) {
  return page.evaluate(async () => {
    let frames = 0, bytes = 0;
    for (const pc of globalThis.__pcs ?? []) {
      (await pc.getStats()).forEach((r) => {
        if (r.type === 'inbound-rtp') { frames += r.framesDecoded ?? 0; bytes += r.bytesReceived ?? 0; }
      });
    }
    return { frames, bytes };
  });
}
const HOOK = `(() => { globalThis.__pcs = [];
  const O = globalThis.RTCPeerConnection;
  globalThis.RTCPeerConnection = function (...a) { const pc = new O(...a); globalThis.__pcs.push(pc); return pc; };
  globalThis.RTCPeerConnection.prototype = O.prototype; Object.assign(globalThis.RTCPeerConnection, O); })();`;

const server = await serve('live_host', 8803);
const ts = Date.now();
let stream;
try {
  stream = await post('/v1/live-streams', { title: `sdktest-live-${ts}`, hostIdentity: 'host-alice' });
  console.log(`\n### raven_live — stream ${stream.id ?? stream.streamId}\n`);
} catch (e) { console.log('COULD NOT CREATE STREAM:', e.message); process.exit(1); }
const sid = stream.id ?? stream.streamId;

const bHost = await chromium.launch({ args: CHROME_ARGS });
const bView = await chromium.launch({ args: CHROME_ARGS });
const pH = await bHost.newPage();
const pV = await bView.newPage();
for (const p of [pH, pV]) {
  await p.addInitScript(HOOK);
  p.on('console', (m) => { const t = m.text(); if (t.includes('[flutter')) console.log(`    · ${t.slice(0, 150)}`); });
}

try {
  await post(`/v1/live-streams/${sid}/start`, {});
  record('raven_live', 'stream transitions CREATED -> LIVE', true, 'start() accepted');

  const hostCreds = await post(`/v1/live-streams/${sid}/hosts`, { identity: 'host-alice' });
  record('raven_live', 'host credentials carry both planes', !!hostCreds.rtc?.token && !!hostCreds.chat?.token,
    `role=${hostCreds.role} rtc=${!!hostCreds.rtc?.token} chat=${!!hostCreds.chat?.token} chatRootMessageId=${!!hostCreds.chatRootMessageId}`);

  await pH.goto(url(8803, hostCreds));
  const sH = await waitForState(pH, (s) => s.ready || s.error, { label: 'host ready', timeout: 70000 });
  record('raven_live', 'RavenLiveStream.join() composes rtc + chat', !sH.error && sH.ready === true, sH.error ? JSON.stringify(sH.error) : `connectionState=${sH.connectionState}`);
  record('raven_live', 'host publishes camera', sH.cameraPublished === true, `cameraPublished=${sH.cameraPublished}`);
  record('raven_live', 'host publishes microphone', sH.microphonePublished === true, `microphonePublished=${sH.microphonePublished}`);
  record('raven_live', 'chat connects alongside the room', !sH.connectError, sH.connectError ?? 'no chat connect error');

  await sleep(4000);
  const viewerCreds = await post(`/v1/live-streams/${sid}/viewer-tokens`, { identity: 'viewer-bob' });
  record('raven_live', 'viewer token is issued', !!viewerCreds.rtc?.token, `role=${viewerCreds.role}`);
  record('raven_live', 'viewer role maps to VIEWER (not host)', viewerCreds.role === 'VIEWER', `role=${viewerCreds.role}`);

  await pV.goto(url(8803, viewerCreds));
  const sV = await waitForState(pV, (s) => s.ready || s.error, { label: 'viewer ready', timeout: 70000 });
  record('raven_live', 'viewer joins a live stream in progress', !sV.error && sV.ready === true, sV.error ? JSON.stringify(sV.error) : `connectionState=${sV.connectionState}`);
  record('raven_live', 'viewer does not publish', sV.cameraPublished !== true && sV.microphonePublished !== true, `camera=${sV.cameraPublished} mic=${sV.microphonePublished}`);

  await sleep(6000);
  const v1 = await inboundStats(pV);
  await sleep(6000);
  const v2 = await inboundStats(pV);
  record('raven_live', 'viewer decodes real media from the host', v2.frames > v1.frames && v2.bytes > v1.bytes, `frames ${v1.frames}->${v2.frames}, bytes ${v1.bytes}->${v2.bytes}`);

  const ended = await post(`/v1/live-streams/${sid}/end`, {}).then(() => true).catch((e) => e.message);
  record('raven_live', 'stream can be ended server-side', ended === true, ended === true ? 'LIVE -> ENDED' : String(ended).slice(0, 110));
} finally {
  await bHost.close(); await bView.close(); server.close();
  await post(`/v1/live-streams/${sid}/end`, {}).catch(() => {});
}
