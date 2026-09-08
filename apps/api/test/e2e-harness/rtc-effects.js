// Real-browser E2E harness for Phase 16 (Raven Effects), driven by
// apps/api/test/effects-rtc.e2e-spec.ts via Playwright. Publishes/subscribes
// through the actual @corvidhq/rtc build against a real Raven SFU;
// nothing here is mocked. State is exposed on `window.__state` so the test
// can poll it, and a couple of actions are exposed for the test to trigger
// mid-call (disable/remove an effect) without needing DOM controls.
import { createRTCClient } from './vendor/raven-rtc.js';
import { effects } from './vendor/raven-effects.js';

const params = new URLSearchParams(location.search);
const token = params.get('token');
const endpoint = params.get('endpoint');
// Host-candidate-only on purpose: both peers are on the same machine as
// the SFU in this test, and routing ICE through the real
// STUN/TURN servers the API mints (reachable over the public internet)
// has proved unstable in this specific sandboxed network, so
// see the e2e-spec.ts module doc for the investigation.
const iceServers = [];
void params.get('iceServers');
const role = params.get('role'); // 'publisher' | 'subscriber'
const roomId = params.get('roomId');
const preset = params.get('preset'); // optional preset name to apply, publisher only

window.__state = { connectionState: 'connecting', error: null };

// `debug` so the SDK's own negotiation and subscription logging reaches
// the page console, which the test collects (helpers/page-diagnostics.ts).
// A browser e2e that fails with nothing but a timeout is not diagnosable.
const client = createRTCClient({ token, endpoint, iceServers, logLevel: 'debug' });
window.__client = client;

console.log(`[harness:${role}] joining room=${roomId}`);
const room = await client.join(roomId);
window.__room = room;
window.__state.connectionState = room.connectionState;
console.log(`[harness:${role}] joined, connectionState=${room.connectionState}`);
// `join()` resolves on the control-plane join; ICE and DTLS complete a
// moment later. A publisher must not report ready before then, or the
// test asserts on a connection that is still coming up.
if (role === 'publisher') {
  try {
    await room.waitUntilConnected(20_000);
    window.__state.connectionState = room.connectionState;
    console.log(`[harness:${role}] media connected`);
  } catch (err) {
    window.__state.connectError = { code: err?.code, message: err?.message };
    console.log(`[harness:${role}] media never connected`, err?.code, err?.message);
  }
}
room.on('connectionStateChanged', (state) => {
  console.log(`[harness:${role}] connectionStateChanged -> ${state}`);
  window.__state.connectionState = state;
});
room.on('participantJoined', (p) => console.log(`[harness:${role}] participantJoined ${p.identity}`));
// `trackPublished` carries the track *kind*, not a publication object.
room.on('trackPublished', (kind, p) => console.log(`[harness:${role}] trackPublished kind=${kind} from=${p?.identity}`));
room.on('localTrackPublished', (t) => console.log(`[harness:${role}] localTrackPublished kind=${t?.kind}`));

room.on('trackSubscribed', (track, participant) => {
  console.log(`[harness:${role}] trackSubscribed kind=${track.kind} from=${participant?.identity}`);
  if (track.kind !== 'camera') return;
  track.attach(document.getElementById('remoteVideo'));
  window.__state.remoteTrackSubscribed = true;
});

room.on('trackUnsubscribed', () => {
  window.__state.remoteTrackSubscribed = false;
});
room.on('error', (e) => console.log(`[harness:${role}] room error`, e?.code, e?.message));

if (role === 'publisher') {
  const camera = await room.enableCamera();
  console.log(`[harness:${role}] camera enabled, track id=${camera.mediaStreamTrack.id}`);
  camera.attach(document.getElementById('localVideo'));
  window.__camera = camera;

  const pipeline = effects.createPipeline();
  window.__pipeline = pipeline;
  pipeline.on('error', (e) => {
    window.__state.effectsError = { code: e.code, message: e.message };
  });

  if (preset && effects.presets[preset]) {
    pipeline.applyPreset(effects.presets[preset]);
  }

  await camera.attachEffects(pipeline);
  window.__state.engineKind = pipeline.engineKind;
  window.__state.effectsAttached = true;

  // Exposed for the test to drive mid-call, matching Phase 16 §26's
  // "removing effect works" / "disabling effect works" requirements.
  window.__disableEffects = () => pipeline.disable();
  window.__enableEffects = () => pipeline.enable();
  window.__clearEffects = () => pipeline.clear();
  window.__detachEffects = () => camera.detachEffects();
}

window.__ready = true;
