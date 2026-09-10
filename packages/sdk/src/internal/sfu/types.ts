import type { LocalTrack, TrackKind } from '../../track';
import type { RemoteParticipant, LocalParticipant } from '../../participant';
import type { RemoteTrack } from '../../track';

export type SdkConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

/**
 * A coarse quality signal, reported by the SFU. The client doesn't derive
 * it from raw stats; it's whatever the SFU itself computed. The SFU has by
 * far the better view: it sees loss and jitter on every leg of the room,
 * not just this one client's.
 *
 * `'unknown'` covers both "not connected yet" and "the SFU has nothing to
 * say", which is the honest answer either way. It's also the usual answer
 * right now, since Livqeno's SFU doesn't compute a quality verdict yet. See
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
  /** Phase 11 addition. Lets a UI show a muted indicator without polling `track.isMuted`. */
  trackMuted: (kind: TrackKind, participant: RemoteParticipant) => void;
  trackUnmuted: (kind: TrackKind, participant: RemoteParticipant) => void;
  localTrackPublished: (track: LocalTrack) => void;
  localTrackUnpublished: (track: LocalTrack) => void;
  dataReceived: (payload: Uint8Array, participant?: RemoteParticipant) => void;
  mediaError: (error: Error) => void;
}

/**
 * The boundary between the public Room API and whatever actually
 * implements the connection.
 *
 * This interface is the reason swapping LiveKit out for Livqeno's own SFU
 * didn't touch the public API. `Room` and `RTCClient` are written against
 * it, never against a particular implementation, so trading
 * `internal/sfu/livekit-adapter.ts` for `internal/sfu/raven-adapter.ts`
 * came down to one line in the default factory. It also lets tests drive
 * Room/Client logic through a fake adapter instead of a real browser and
 * WebRTC stack.
 */
export interface SFUAdapter {
  readonly connectionState: SdkConnectionState;
  readonly localParticipant: LocalParticipant;
  readonly remoteParticipants: Map<string, RemoteParticipant>;

  /** The SFU's own read on this connection's health right now. */
  getConnectionQuality(): ConnectionQuality;

  /**
   * Live ICE and signaling state, where the implementation can see it.
   *
   * Optional, because not every adapter owns an `RTCPeerConnection` to read
   * it from. The LiveKit adapter didn't, which is why
   * `Room.getDiagnostics()` reported these as `undefined` for so long. The
   * native adapter does, so a bug report now carries the states that
   * actually explain a failed connection.
   */
  getIceConnectionState?(): string | undefined;
  getSignalingState?(): string | undefined;
  /**
   * The SFU's own view of the connection. It can disagree with the local
   * one, and that disagreement is frequently the entire diagnosis.
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
  /**
   * Makes sure a data channel exists, for a participant that wants to
   * *receive* data.
   *
   * The SFU fans data out over each recipient's own channel, so a
   * participant with no channel cannot receive — and one is only created
   * on demand, because most calls never send a byte. Listening for
   * `dataReceived` is that demand.
   *
   * Optional so an adapter with no channel concept (or a test double)
   * satisfies this interface untouched.
   */
  ensureDataChannel?(): void;

  getDevices(kind?: DeviceKind): Promise<DeviceInfo[]>;
  /**
   * Phase 11 widened this from `'videoinput' | 'audioinput'` to the full
   * `DeviceKind`. Purely additive: every existing caller passing one of the
   * original two values carries on unaffected. What it buys is
   * `'audiooutput'`, i.e. speaker selection, on browsers that support
   * `setSinkId`.
   */
  setDevice(kind: DeviceKind, deviceId: string): Promise<void>;
}
