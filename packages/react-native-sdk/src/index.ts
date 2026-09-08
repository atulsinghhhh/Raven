export { Raven } from './raven';
export type { RavenConfig, RavenChatHandle, RavenAppState } from './types';

// ---------------------------------------------------------------------------
// Live Streaming (Phase 14). A thin wrapper round `Raven`, not a parallel
// RTC/chat implementation. See src/live-stream.ts.
// ---------------------------------------------------------------------------
export { RavenLiveStream, joinLiveStream } from './live-stream';
export type { RavenLiveStreamOptions } from './live-stream';
export type { LiveStreamCredentials, LiveStreamRole } from './types';

export { RavenVideoView } from './video-view';
export type { RavenVideoViewProps } from './video-view';

export { permissions } from './permissions';
export type { PermissionResult } from './permissions';

export { audio } from './audio';
export type { RavenAudioOutput } from './audio';

export {
  useCamera,
  useConnectionState,
  useLiveStream,
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
 * Only call this by hand if you need the WebRTC globals in place before a
 * `Raven` instance exists, say to render a camera preview on a pre-join
 * screen. Otherwise `new Raven(...)` handles it.
 */
export { bootstrapRavenNative } from './internal/bootstrap';

export { RN_SDK_VERSION } from './version';

// ---------------------------------------------------------------------------
// Effects (Phase 16). effects.ts has the full architecture note.
// Filter/preset config is real; the native processing engine is planned.
// ---------------------------------------------------------------------------
export {
  beauty,
  createEffectsPipeline,
  EFFECT_SECURITY_LIMITS,
  EFFECTS_NATIVE_ENGINE_STATUS,
  filters,
  isEffectsError,
  presets,
} from './effects';
export type {
  ColorOpParams,
  EffectInstance,
  EffectsError,
  EffectsErrorCode,
  EffectsPipeline,
  EffectsEngineStatus,
  FilterConfig,
  Preset,
} from './effects';

/**
 * Re-exported from `@corvidhq/rtc` so a mobile app needs one import for the
 * common types. These are the *same* types the web SDK uses: a `Room` here
 * is a `Room` there. That's what makes the two platforms one mental model
 * instead of two APIs that merely resemble each other (spec §10).
 *
 * A WebRTC type is never re-exported, on either platform.
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

// Pointedly not exported: the signaling client, the peer-connection
// adapter, `registerGlobals` internals, RTCView, the chat WebSocket
// protocol, and every other implementation detail. Nobody using this
// package should ever need to know a WebRTC or a WebSocket is involved
// (spec §2, §21).
