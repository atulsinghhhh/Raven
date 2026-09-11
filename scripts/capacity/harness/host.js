// The publishing side of the capacity rig: one host, one camera, one
// microphone, joined through the same `@ravenkash/client` LiveStream an
// application would use, with credentials minted by the runner against the
// real `POST /v1/live-streams/:id/hosts` endpoint.
//
// # Why the camera is captured here instead of via `room.enableCamera()`
//
// `enableCamera()` takes no arguments; its constraints are the SDK's
// 720p-ideal defaults. The publish profile is the single largest input to
// every throughput number this rig produces — the SFU's outbound is
// N subscribers times whichever simulcast layer each is on — so it has to
// be a parameter of the experiment rather than a default nobody wrote
// down. `createCustomTrack()` is the public, documented way to publish a
// track the application captured itself; its own doc names "a synthetic
// track in a test harness" as a case it exists for. Everything downstream
// of it — encoder, simulcast, publish, stats — is the identical path
// `enableCamera()` takes.
import { LiveStream } from '@ravenkash/client';
import { createCustomTrack } from '@ravenkash/rtc';

/** Matches the SDK's own VIDEO_PROFILES, so '720p' here is what enableCamera() would have captured. */
const PROFILES = {
  '180p': { width: 320, height: 180, frameRate: 30 },
  '360p': { width: 640, height: 360, frameRate: 30 },
  '480p': { width: 854, height: 480, frameRate: 30 },
  '720p': { width: 1280, height: 720, frameRate: 30 },
};

const params = new URLSearchParams(location.search);
const credentials = JSON.parse(decodeURIComponent(params.get('credentials')));
const profileName = params.get('profile') || '360p';
const withAudio = params.get('audio') !== 'false';

const state = {
  ready: false,
  error: null,
  connectionState: 'connecting',
  publishedKinds: [],
  profile: profileName,
  capturedSettings: null,
};
window.__state = state;

const logLines = [];
function log(message) {
  logLines.push(`${Math.round(performance.now())}ms ${message}`);
  document.getElementById('log').textContent = logLines.slice(-40).join('\n');
  console.log(`[host] ${message}`);
}
window.__log = () => logLines.join('\n');

const TAG = 'host';

try {
  const profile = PROFILES[profileName];
  if (!profile) throw new Error(`unknown profile ${profileName}`);

  window.__pcTag = TAG;
  const stream = await LiveStream.join(credentials);
  window.__pcTag = null;
  window.__stream = stream;
  state.connectionState = stream.room.connectionState;
  log(`joined role=${stream.role} state=${stream.room.connectionState}`);

  stream.room.on('connectionStateChanged', (next) => {
    state.connectionState = next;
    log(`connectionState -> ${next}`);
  });
  stream.room.on('error', (e) => log(`room error ${e?.code} ${e?.message}`));

  await stream.room.waitUntilConnected(30_000);
  state.connectionState = stream.room.connectionState;
  log('media connected');

  const media = await navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: profile.width },
      height: { ideal: profile.height },
      frameRate: { ideal: profile.frameRate },
    },
    audio: withAudio ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true } : false,
  });

  const videoTrack = media.getVideoTracks()[0];
  state.capturedSettings = videoTrack.getSettings();
  const camera = createCustomTrack(videoTrack, { source: 'camera' });
  camera.attach(document.getElementById('localVideo'));
  await stream.room.publish(camera);
  window.__camera = camera;
  state.publishedKinds.push('camera');
  log(
    `camera published ${state.capturedSettings.width}x${state.capturedSettings.height}@${state.capturedSettings.frameRate}`,
  );

  if (withAudio) {
    const mic = createCustomTrack(media.getAudioTracks()[0], { source: 'microphone' });
    await stream.room.publish(mic);
    window.__mic = mic;
    state.publishedKinds.push('microphone');
    log('microphone published');
  }

  window.__sendStats = () => window.__rawSendStats(TAG, stream.room);
  state.ready = true;
  log('ready');
} catch (err) {
  state.error = { code: err?.code, message: err?.message ?? String(err) };
  log(`FAILED ${err?.code ?? ''} ${err?.message ?? err}`);
}
