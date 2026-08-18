import type { LocalTrack, TrackKind } from '../../track';
import type { RemoteParticipant, LocalParticipant } from '../../participant';
import type { RemoteTrack } from '../../track';

export type SdkConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

export type DeviceKind = 'videoinput' | 'audioinput' | 'audiooutput';

export interface DeviceInfo {
  deviceId: string;
  label: string;
  kind: DeviceKind;
}

export interface SFUAdapterEventMap {
  connectionStateChanged: (state: SdkConnectionState) => void;
  participantJoined: (participant: RemoteParticipant) => void;
  participantLeft: (participant: RemoteParticipant) => void;
  trackPublished: (kind: TrackKind, participant: RemoteParticipant) => void;
  trackUnpublished: (kind: TrackKind, participant: RemoteParticipant) => void;
  trackSubscribed: (track: RemoteTrack, participant: RemoteParticipant) => void;
  trackUnsubscribed: (track: RemoteTrack, participant: RemoteParticipant) => void;
  /** Phase 11 addition — lets a UI show a muted indicator without polling `track.isMuted`. */
  trackMuted: (kind: TrackKind, participant: RemoteParticipant) => void;
  trackUnmuted: (kind: TrackKind, participant: RemoteParticipant) => void;
  localTrackPublished: (track: LocalTrack) => void;
  localTrackUnpublished: (track: LocalTrack) => void;
  dataReceived: (payload: Uint8Array, participant?: RemoteParticipant) => void;
  mediaError: (error: Error) => void;
}

/**
 * Boundary between the public Room API and whatever SFU library actually
 * implements the connection (livekit-client right now — see
 * internal/sfu/livekit-adapter.ts). Room never imports livekit-client
 * directly, so the public API survives an SFU swap. Also lets tests
 * exercise Room/Client logic with a fake adapter instead of a real
 * browser + WebRTC stack.
 */
export interface SFUAdapter {
  readonly connectionState: SdkConnectionState;
  readonly localParticipant: LocalParticipant;
  readonly remoteParticipants: Map<string, RemoteParticipant>;

  connect(endpoint: string, token: string, iceServers?: RTCIceServer[]): Promise<void>;
  disconnect(): Promise<void>;

  on<E extends keyof SFUAdapterEventMap>(event: E, handler: SFUAdapterEventMap[E]): void;
  off<E extends keyof SFUAdapterEventMap>(event: E, handler: SFUAdapterEventMap[E]): void;

  enableCamera(enabled: boolean): Promise<LocalTrack | undefined>;
  enableMicrophone(enabled: boolean): Promise<LocalTrack | undefined>;
  enableScreenShare(enabled: boolean): Promise<LocalTrack | undefined>;
  publish(track: LocalTrack): Promise<void>;
  unpublish(track: LocalTrack): Promise<void>;

  sendData(payload: Uint8Array<ArrayBuffer>): Promise<void>;

  getDevices(kind?: DeviceKind): Promise<DeviceInfo[]>;
  /**
   * Phase 11 widened this from `'videoinput' | 'audioinput'` to the full
   * `DeviceKind` — a purely additive change (every existing caller passing
   * one of the original two values is unaffected) that lets `'audiooutput'`
   * (speaker selection) through, where the browser supports `setSinkId`.
   */
  setDevice(kind: DeviceKind, deviceId: string): Promise<void>;
}
