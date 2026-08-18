export { RavenRoom } from './raven-room';
export type { RavenRoomProps } from './raven-room';

export {
  useCamera,
  useConnectionState,
  useLocalParticipant,
  useMicrophone,
  useParticipants,
  useRaven,
  useRavenClient,
  useRavenError,
  useRemoteParticipants,
  useRoom,
} from './hooks';
export type { UseRavenResult } from './hooks';

export { LocalParticipantView, ParticipantView, RavenAudio, RavenVideo } from './components';
export type { ParticipantViewProps, RavenAudioProps, RavenVideoProps } from './components';

export type { RavenConnectionState, RavenSnapshot } from './store';

// Re-exported for convenience so a developer building with @raven/react
// doesn't also need a direct @raven/rtc import for common types —
// LiveKit itself is still never re-exported (Phase 11 spec §27).
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
  RTCClientConfig,
  RTCError,
  RTCErrorCode,
  Track,
  TrackKind,
} from '@raven/rtc';
export { isRTCError } from '@raven/rtc';
