export { Raven } from './raven';
export type { RavenConfig, RavenChatHandle, RavenAppState } from './types';

export { RavenVideoView } from './video-view';
export type { RavenVideoViewProps } from './video-view';

export { permissions } from './permissions';
export type { PermissionResult } from './permissions';

export { audio } from './audio';
export type { RavenAudioOutput } from './audio';

export {
  useCamera,
  useConnectionState,
  useMicrophone,
  useParticipants,
  useRavenError,
  useRemoteParticipants,
  useRoom,
} from './hooks';
export type { MediaToggle } from './hooks';

export {
  RavenPermissionError,
  RTCError,
  isRavenPermissionError,
  isRTCError,
} from './errors';
export type { RavenPermissionKind, RavenPermissionStatus, RTCErrorCode } from './errors';

/**
 * Call this manually only if you need the WebRTC globals installed before
 * a `Raven` instance exists — for example to render a camera preview on a
 * pre-join screen. `new Raven(...)` calls it for you otherwise.
 */
export { bootstrapRavenNative } from './internal/bootstrap';

export { RN_SDK_VERSION } from './version';

/**
 * Re-exported from `@corvidhq/rtc` so a mobile app needs one import for the
 * common types. These are the *same* types the web SDK uses — a `Room`
 * here is a `Room` there — which is what makes the two platforms one
 * mental model rather than two APIs that resemble each other (spec §10).
 *
 * LiveKit types are never re-exported, on either platform.
 */
export type {
  ConnectionState,
  DeviceInfo,
  DeviceKind,
  LocalParticipant,
  LocalTrack,
  Participant,
  RemoteParticipant,
  RemoteTrack,
  Room,
  Track,
  TrackKind,
  LogLevel,
} from '@corvidhq/rtc';

// Deliberately not exported: the LiveKit adapter, `registerGlobals`
// internals, RTCView, the chat WebSocket protocol, and every other
// implementation detail. A developer using this package should never
// need to know WebRTC or a WebSocket is involved (spec §2, §21).
