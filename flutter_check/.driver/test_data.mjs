import { chromium } from 'playwright';
import { serve, makeRoom, rtcToken, waitForState, record, del } from './lib.mjs';

const url = (port, params) => `http://localhost:${port}/?` + new URLSearchParams(params).toString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = await serve('data', 8802);
const ts = Date.now();
const room = await makeRoom(`sdktest-data-${ts}`);
console.log(`\n### raven_rtc data channel — room ${room.name}\n`);

const a = await rtcToken(room.id, 'alice');
const b = await rtcToken(room.id, 'bob');
const ice = JSON.stringify(a.iceServers);

const browser = await chromium.launch();
const ctx = await browser.newContext();
const pA = await ctx.newPage();
const pB = await ctx.newPage();

try {
  await pA.goto(url(8802, { token: a.token, endpoint: a.endpoint, roomId: room.id, iceServers: ice }));
  const sA = await waitForState(pA, (s) => s.ready || s.error, { label: 'alice ready', timeout: 60000 });
  record(
    'raven_rtc/data',
    'join() with nothing published',
    !sA.error && sA.connectionState === 'connected',
    sA.error ? JSON.stringify(sA.error) : `connectionState=${sA.connectionState}`,
  );

  // Send before the peer exists and before the channel can be open: must
  // queue, not throw and not drop (the 0.1.5 fix).
  await pA.evaluate(() => globalThis.__doSendData('queued-before-peer'));

  await pB.goto(url(8802, { token: b.token, endpoint: b.endpoint, roomId: room.id, iceServers: ice }));
  const sB = await waitForState(pB, (s) => s.ready || s.error, { label: 'bob ready', timeout: 60000 });
  record(
    'raven_rtc/data',
    'receive-only participant negotiates a data channel',
    !sB.error && sB.connectionState === 'connected',
    sB.error ? JSON.stringify(sB.error) : `connectionState=${sB.connectionState}`,
  );

  const queued = await waitForState(pA, (s) => (s.sentData ?? []).includes('queued-before-peer') || s.sendDataError, {
    label: 'queued send resolves',
    timeout: 30000,
  }).catch((e) => ({ _err: e.message }));
  record(
    'raven_rtc/data',
    'sendData() before the channel opens is queued, not dropped',
    !queued._err && !queued.sendDataError,
    queued.sendDataError ?? (queued._err ? 'never resolved' : 'resolved'),
  );

  await sleep(2500);
  await pB.evaluate(() => globalThis.__doSendData('hello-from-bob'));
  const recvA = await waitForState(pA, (s) => (s.receivedData ?? []).includes('hello-from-bob'), {
    label: 'alice receives',
    timeout: 30000,
  }).catch((e) => ({ _err: e.message }));
  record(
    'raven_rtc/data',
    'data is relayed between participants',
    !recvA._err,
    recvA._err ? 'never received' : `receivedData=${JSON.stringify(recvA.receivedData)}`,
  );

  await pA.evaluate(() => globalThis.__doSendData('hello-from-alice'));
  const recvB = await waitForState(pB, (s) => (s.receivedData ?? []).includes('hello-from-alice'), {
    label: 'bob receives',
    timeout: 30000,
  }).catch((e) => ({ _err: e.message }));
  record(
    'raven_rtc/data',
    'data flows in the other direction too',
    !recvB._err,
    recvB._err ? 'never received' : `receivedData=${JSON.stringify(recvB.receivedData)}`,
  );
} finally {
  await browser.close();
  server.close();
  await del(`/v1/rooms/${room.id}`).catch(() => {});
}
