// The egress worker's browser-side half: joins a stream exactly the way
// any real viewer's @ravenkash/client would (same package, same join
// path, same publish:false credential shape) and relays the host's real
// decoded media out to the Node process for ffmpeg to consume.
//
// Deliberately not a from-scratch WebRTC/signaling reimplementation: this
// repo's own capacity-test harness (scripts/capacity/harness) already
// established the pattern of driving the real, published SDK from inside
// a headless Chromium page rather than reimplementing its protocol —
// see docs/architecture/cdn-hls-egress-scope.md's Option B reasoning for
// why the egress path reuses the existing join path instead of touching
// the SFU's core media path. This file is that same pattern, purpose-built
// for one internal, non-public participant instead of a shard of viewers.
import { LiveStream } from '@ravenkash/client';

/** Base64-encodes a chunk in bounded-size pieces — a single String.fromCharCode(...bytes) spread can blow the call stack on a large chunk. */
function toBase64(bytes) {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

let stream;
let recorder;
let videoTrack;
let audioTrack;

/**
 * Video-only, on purpose — a known, reproduced limitation, not an
 * oversight. Combining a real received WebRTC audio track (Opus) with the
 * video track in one `MediaRecorder` reliably reports `state: "recording"`
 * with both tracks `readyState: "live"`, yet never produces output: every
 * `ondataavailable` (including via explicit `requestData()`, which does
 * fire — the auto timeslice callback does not) delivers a zero-byte blob
 * indefinitely. Recording the video track alone works correctly and is
 * what every real HLS segment produced by this worker has been verified
 * against. Follow-up: either resolve the underlying MediaRecorder
 * dual-track issue, or encode/mux audio through a separate path (e.g. a
 * second MediaRecorder / raw PCM capture muxed by ffmpeg alongside video)
 * instead of relying on one combined MediaStream.
 */
function startRecorder() {
  if (recorder || !videoTrack) return;
  const media = new MediaStream([videoTrack]);
  console.log(`starting MediaRecorder: video=${!!videoTrack} audio=${!!audioTrack} (audio track present but not yet included — see comment)`);

  try {
    recorder = new MediaRecorder(media, { mimeType: 'video/webm;codecs=vp8' });
    recorder.ondataavailable = (event) => {
      if (event.data.size === 0) return;
      event
        .data
        .arrayBuffer()
        .then((buffer) => window.__onChunk(toBase64(new Uint8Array(buffer))))
        .catch((err) => window.__onEvent({ type: 'chunkRelayError', message: String(err) }));
    };
    recorder.onerror = (event) => window.__onEvent({ type: 'recorderError', message: String(event.error ?? event) });
    recorder.start(1000);
    window.__onEvent({ type: 'recording' });
  } catch (err) {
    window.__onEvent({ type: 'recorderStartFailed', message: err?.message ?? String(err) });
  }
}

window.__join = async (credentials) => {
  try {
    stream = await LiveStream.join(credentials);
    window.__onEvent({ type: 'joined' });

    stream.room.on('trackSubscribed', (track) => {
      if (track.kind === 'camera') {
        videoTrack = track.mediaStreamTrack;
        startRecorder();
      } else if (track.kind === 'microphone') {
        audioTrack = track.mediaStreamTrack; // tracked, not yet recorded — see startRecorder's doc comment
      }
    });
    stream.room.on('connectionStateChanged', (next) => window.__onEvent({ type: 'connectionState', state: next }));
    stream.room.on('error', (err) => window.__onEvent({ type: 'roomError', code: err?.code, message: err?.message }));
  } catch (err) {
    window.__onEvent({ type: 'joinFailed', code: err?.code, message: err?.message ?? String(err) });
  }
};

window.__leave = async () => {
  try {
    recorder?.stop();
    await stream?.leave();
  } finally {
    window.__onEvent({ type: 'left' });
  }
};

window.__ready = true;
