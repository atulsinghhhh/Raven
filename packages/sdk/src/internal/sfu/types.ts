import type { LocalTrack, TrackKind } from '../../track';
import type { RemoteParticipant, LocalParticipant } from '../../participant';
import type { RemoteTrack } from '../../track';

export type SdkConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

/**
 * A coarse, SFU-reported quality signal — not derived from raw stats by
 * the client, but read from whatever the SFU itself computes. The SFU has
 * a much better vantage point: it sees loss and jitter from every leg of
 * the room, not just this one client's.
 *
 * `'unknown'` covers "not connected yet" and "the SFU has nothing to
 * report", which is the honest answer in both cases — and, currently, the
 * usual one: Raven's SFU does not yet compute a quality verdict. See
 * `RavenAdapter.getConnectionQuality`.
 */
export type ConnectionQuality = 'excellent' | 'good' | 'poor' | 'lost' | 'unknown';

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
 * Boundary between the public Room API and whatever actually implements
 * the connection.
 *
 * This interface is why replacing LiveKit with Raven's own SFU did not
 * change the public API: `Room` and `RTCClient` are written against it and
 * never against a specific implementation, so swapping
 * `internal/sfu/livekit-adapter.ts` for `internal/sfu/raven-adapter.ts`
 * was a one-line change to the default factory. It also lets tests
 * exercise Room/Client logic with a fake adapter instead of a real
 * browser and WebRTC stack.
 */
export interface SFUAdapter {
  readonly connectionState: SdkConnectionState;
  readonly localParticipant: LocalParticipant;
  readonly remoteParticipants: Map<string, RemoteParticipant>;

  /** The SFU's own read on this connection's health right now. */
  getConnectionQuality(): ConnectionQuality;

  /**
   * Live ICE/signaling state, where the implementation can see it.
   *
   * Optional because not every adapter owns a `RTCPeerConnection` it can
   * read this from — the LiveKit adapter could not, which is why
   * `Room.getDiagnostics()` reported these as `undefined` for so long.
   * The native adapter can, so a bug report now carries the states that
   * actually explain a failed connection.
   */
  getIceConnectionState?(): string | undefined;
  getSignalingState?(): string | undefined;
  /**
   * The SFU's own view of the connection, which can disagree with the
   * local one — and that disagreement is often the whole diagnosis.
   */
  getRemoteConnectionState?(): { iceState?: string; peerState?: string };

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
