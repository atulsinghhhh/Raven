// Real-browser viewer harness for the Flutter Live Streaming E2E check
// (apps/api/test/flutter-live-streaming.e2e-spec.ts). Sibling to
// rtc-effects.js, not a modification of it: that harness is shared by
// other suites, and this one needs a capability it doesn't — direct
// access to the raw RTCPeerConnection so the test can read
// `framesDecoded`/`bytesReceived` straight out of a real
// `getStats()` report, not the SDK's own bitrate-derived TrackStats.
//
// Everything else is the same real `@ravenkash/rtc` browser build the
// other harnesses use (./vendor/raven-rtc.js) against the real SFU;
// nothing here is mocked.
import { createRTCClient } from './vendor/raven-rtc.js';

const params = new URLSearchParams(location.search);
const token = params.get('token');
const endpoint = params.get('endpoint');
const roomId = params.get('roomId');
// Same host-candidate-only rationale as rtc-effects.js: see that file's
// module doc for why real STUN/TURN routing is skipped in this sandbox.
const iceServers = [];
void params.get('iceServers');

window.__state = { connectionState: 'connecting', remoteTrackSubscribed: false };

// Captured the moment the SDK constructs it, so __stats() can call the
// browser's real getStats() directly instead of going through anything
// the SDK normalizes. There is exactly one peer connection on a
// subscriber-only viewer.
let capturedPc;
const NativeRTCPeerConnection = window.RTCPeerConnection;
window.RTCPeerConnection = class extends NativeRTCPeerConnection {
  constructor(...args) {
    super(...args);
    capturedPc = this;
  }
};

const client = createRTCClient({ token, endpoint, iceServers, logLevel: 'debug' });
window.__client = client;

console.log(`[live-viewer] joining room=${roomId}`);
const room = await client.join(roomId);
window.__room = room;
window.__state.connectionState = room.connectionState;
console.log(`[live-viewer] joined, connectionState=${room.connectionState}`);

room.on('connectionStateChanged', (state) => {
  console.log(`[live-viewer] connectionStateChanged -> ${state}`);
  window.__state.connectionState = state;
});
room.on('participantJoined', (p) => console.log(`[live-viewer] participantJoined ${p.identity}`));
room.on('trackPublished', (kind, p) => console.log(`[live-viewer] trackPublished kind=${kind} from=${p?.identity}`));

room.on('trackSubscribed', (track, participant) => {
  console.log(`[live-viewer] trackSubscribed kind=${track.kind} from=${participant?.identity}`);
  if (track.kind === 'camera') {
    track.attach(document.getElementById('remoteVideo'));
    window.__state.remoteTrackSubscribed = true;
  } else if (track.kind === 'microphone') {
    window.__state.remoteAudioSubscribed = true;
  }
});
room.on('trackUnsubscribed', (track) => {
  console.log(`[live-viewer] trackUnsubscribed kind=${track.kind}`);
  if (track.kind === 'camera') window.__state.remoteTrackSubscribed = false;
});
room.on('error', (e) => console.log('[live-viewer] room error', e?.code, e?.message));

/**
 * Raw WebRTC receive-side stats for the video track, straight off a
 * real `getStats()` call. `framesDecoded` and `bytesReceived` are exactly
 * the WebRTC spec's own inbound-rtp fields: no SDK normalization, no
 * derived bitrate, nothing that could paper over "signaling succeeded
 * but no media is actually arriving."
 */
window.__stats = async () => {
  if (!capturedPc) return null;
  const report = await capturedPc.getStats();
  for (const stat of report.values()) {
    if (stat.type === 'inbound-rtp' && stat.kind === 'video') {
      return {
        timestamp: stat.timestamp,
        framesDecoded: stat.framesDecoded ?? null,
        framesReceived: stat.framesReceived ?? null,
        bytesReceived: stat.bytesReceived ?? null,
        packetsReceived: stat.packetsReceived ?? null,
      };
    }
  }
  return null;
};

window.__ready = true;
