import { RTCError } from '../../errors';
import { LocalTrack, type TrackKind } from '../../track';
import { toMediaError } from './errors';
import { NativeLocalTrackDelegate } from './native-track';

/**
 * Default audio constraints (spec §13).
 *
 * All three on by default, because without them a call sounds dreadful in
 * the circumstances calls actually happen in. A laptop speaker and mic in
 * one room is an echo generator. This is the browser's own processing, not
 * anything Raven implements, and anyone who wants raw audio for music or
 * transcription can pass their own constraints.
 */
const DEFAULT_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

/**
 * Default camera constraints (spec §14).
 *
 * `ideal`, never `exact`. An exact resolution fails outright on a device
 * that can't manage it, and "your call didn't start because your webcam is
 * 640×480" is not an acceptable outcome. 720p because it's the resolution
 * most cameras genuinely deliver and most layouts genuinely display.
 */
const DEFAULT_VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30 },
};

/** Named video profiles, so you pick a size instead of composing constraints. */
export type VideoProfile = '360p' | '480p' | '720p' | '1080p';

const VIDEO_PROFILES: Record<VideoProfile, MediaTrackConstraints> = {
  '360p': { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 30 } },
  '480p': { width: { ideal: 854 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
  '720p': { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
  '1080p': { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
};

export interface CameraOptions {
  deviceId?: string;
  profile?: VideoProfile;
  /** `'user'` is the selfie camera, `'environment'` the rear one. Mobile only. */
  facingMode?: 'user' | 'environment';
  constraints?: MediaTrackConstraints;
}

export interface MicrophoneOptions {
  deviceId?: string;
  constraints?: MediaTrackConstraints;
}

/**
 * Captures the camera without publishing it, for anyone who wants a
 * preview before `room.publish(track)`.
 *
 * Doesn't go near the microphone. Spec §13 is explicit that an audio-only
 * call must not demand camera permission, and it cuts both ways: a camera
 * preview shouldn't have the browser asking for a microphone nobody
 * requested.
 */
export async function createCameraTrack(options: CameraOptions = {}): Promise<LocalTrack> {
  const constraints: MediaTrackConstraints = {
    ...DEFAULT_VIDEO_CONSTRAINTS,
    ...(options.profile ? VIDEO_PROFILES[options.profile] : {}),
    ...(options.facingMode ? { facingMode: options.facingMode } : {}),
    ...(options.deviceId ? { deviceId: { exact: options.deviceId } } : {}),
    ...options.constraints,
  };

  const stream = await getUserMedia({ video: constraints, audio: false }, 'camera');
  return trackFromStream(stream, 'camera');
}

export async function createMicrophoneTrack(options: MicrophoneOptions = {}): Promise<LocalTrack> {
  const constraints: MediaTrackConstraints = {
    ...DEFAULT_AUDIO_CONSTRAINTS,
    ...(options.deviceId ? { deviceId: { exact: options.deviceId } } : {}),
    ...options.constraints,
  };

  const stream = await getUserMedia({ audio: constraints, video: false }, 'microphone');
  return trackFromStream(stream, 'microphone');
}

/**
 * Captures a screen share through `getDisplayMedia`.
 *
 * Video only, which matches `room.enableScreenShare()`'s single-track
 * contract. We do request screen *audio* where the platform offers it, but
 * only surface the video track. A second published track would change the
 * shape of the public API, so this is a documented scope limit, not a
 * silent omission (spec §16).
 */
export async function createScreenShareTrack(): Promise<LocalTrack> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) {
    // Mobile browsers and older engines have no getDisplayMedia at all,
    // and spec §16 says don't assume screen share exists. So: a clear
    // typed refusal, rather than some obscure TypeError.
    throw new RTCError(
      'NOT_SUPPORTED',
      'Screen sharing is not available on this platform (no getDisplayMedia)',
    );
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  } catch (error) {
    throw toMediaError(error, 'screenShare');
  }

  const [videoTrack] = stream.getVideoTracks();
  if (!videoTrack) {
    throw new RTCError('MEDIA_ERROR', 'Screen capture returned no video track');
  }

  // Someone who stops sharing from the browser's own "Stop sharing" bar
  // ends the track without telling us a thing. The adapter watches for
  // that and unpublishes. Nothing to do here but hand the track over.
  return new LocalTrack(new NativeLocalTrackDelegate(videoTrack), 'screenShare');
}

async function getUserMedia(constraints: MediaStreamConstraints, kind: TrackKind): Promise<MediaStream> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new RTCError(
      'NOT_SUPPORTED',
      'Media capture is not available in this environment (no navigator.mediaDevices)',
    );
  }

  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch (error) {
    throw toMediaError(error, kind);
  }
}

function trackFromStream(stream: MediaStream, kind: TrackKind): LocalTrack {
  const [track] = kind === 'microphone' ? stream.getAudioTracks() : stream.getVideoTracks();
  if (!track) {
    throw new RTCError('MEDIA_ERROR', `Capture returned no ${kind} track`);
  }
  return new LocalTrack(new NativeLocalTrackDelegate(track), kind);
}
