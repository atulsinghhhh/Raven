import { RTCError } from './errors';
import { TypedEventEmitter } from './events';
import type { Logger } from './logger';
import { LocalParticipant, RemoteParticipant } from './participant';
import type { SFUAdapter, SdkConnectionState } from './internal/sfu/types';
import { LocalTrack, RemoteTrack, type TrackKind } from './track';

export type ConnectionState = SdkConnectionState;

export interface RoomEventMap {
  connectionStateChanged: (state: ConnectionState) => void;
  connected: () => void;
  disconnected: () => void;
  reconnecting: () => void;
  reconnected: () => void;
  participantJoined: (participant: RemoteParticipant) => void;
  participantLeft: (participant: RemoteParticipant) => void;
  trackPublished: (kind: TrackKind, participant: RemoteParticipant) => void;
  trackUnpublished: (kind: TrackKind, participant: RemoteParticipant) => void;
  trackSubscribed: (track: RemoteTrack, participant: RemoteParticipant) => void;
  trackUnsubscribed: (track: RemoteTrack, participant: RemoteParticipant) => void;
  localTrackPublished: (track: LocalTrack) => void;
  localTrackUnpublished: (track: LocalTrack) => void;
  dataReceived: (payload: Uint8Array, participant?: RemoteParticipant) => void;
  error: (error: RTCError) => void;
}

/**
 * A joined room, returned by `client.join(roomId)` — don't construct it
 * yourself. Owns participant/track state and all room-scoped actions; no
 * SDP, ICE candidates, or RTCPeerConnection leak into this API.
 */
export class Room extends TypedEventEmitter<RoomEventMap> {
  readonly roomId: string;
  readonly localParticipant: LocalParticipant;
  private readonly adapter: SFUAdapter;
  private readonly logger: Logger;

  constructor(adapter: SFUAdapter, roomId: string, logger: Logger) {
    super();
    this.adapter = adapter;
    this.roomId = roomId;
    this.logger = logger;
    this.localParticipant = adapter.localParticipant;
    this.wireAdapterEvents();
  }

  get remoteParticipants(): RemoteParticipant[] {
    return Array.from(this.adapter.remoteParticipants.values());
  }

  get connectionState(): ConnectionState {
    return this.adapter.connectionState;
  }

  private wireAdapterEvents(): void {
    let prevState: ConnectionState = this.adapter.connectionState;

    this.adapter.on('connectionStateChanged', (state) => {
      this.emit('connectionStateChanged', state);

      if (state === 'connected') {
        this.emit(prevState === 'reconnecting' ? 'reconnected' : 'connected');
      } else if (state === 'reconnecting' && prevState !== 'reconnecting') {
        this.emit('reconnecting');
      } else if (state === 'disconnected' || state === 'failed') {
        this.emit('disconnected');
        if (state === 'failed') {
          this.emit(
            'error',
            new RTCError('CONNECTION_FAILED', 'Connection failed after exhausting reconnect attempts'),
          );
        }
      }

      prevState = state;
    });

    this.adapter.on('participantJoined', (participant) => this.emit('participantJoined', participant));
    this.adapter.on('participantLeft', (participant) => this.emit('participantLeft', participant));
    this.adapter.on('trackPublished', (kind, participant) => this.emit('trackPublished', kind, participant));
    this.adapter.on('trackUnpublished', (kind, participant) => this.emit('trackUnpublished', kind, participant));
    this.adapter.on('trackSubscribed', (track, participant) => this.emit('trackSubscribed', track, participant));
    this.adapter.on('trackUnsubscribed', (track, participant) => this.emit('trackUnsubscribed', track, participant));
    this.adapter.on('localTrackPublished', (track) => this.emit('localTrackPublished', track));
    this.adapter.on('localTrackUnpublished', (track) => this.emit('localTrackUnpublished', track));
    this.adapter.on('dataReceived', (payload, participant) => this.emit('dataReceived', payload, participant));
    this.adapter.on('mediaError', (error) => {
      this.logger.warn('media device error', error.message);
      this.emit('error', new RTCError('MEDIA_ERROR', error.message, error));
    });
  }

  /** Captures and publishes the camera in one call. Resolves to the published track. */
  async enableCamera(): Promise<LocalTrack | undefined> {
    return this.adapter.enableCamera(true);
  }

  /** Stops publishing and releases the camera. */
  async disableCamera(): Promise<void> {
    await this.adapter.enableCamera(false);
  }

  /** Captures and publishes the microphone in one call. Resolves to the published track. */
  async enableMicrophone(): Promise<LocalTrack | undefined> {
    return this.adapter.enableMicrophone(true);
  }

  /** Stops publishing and releases the microphone. */
  async disableMicrophone(): Promise<void> {
    await this.adapter.enableMicrophone(false);
  }

  /** Captures and publishes a screen share in one call. */
  async enableScreenShare(): Promise<LocalTrack | undefined> {
    return this.adapter.enableScreenShare(true);
  }

  async disableScreenShare(): Promise<void> {
    await this.adapter.enableScreenShare(false);
  }

  /** Publishes a track created via `client.createCameraTrack()` et al. */
  async publish(track: LocalTrack): Promise<void> {
    await this.adapter.publish(track);
  }

  async unpublish(track: LocalTrack): Promise<void> {
    await this.adapter.unpublish(track);
  }

  /** Switches the active camera without republishing. */
  async setCameraDevice(deviceId: string): Promise<void> {
    await this.adapter.setDevice('videoinput', deviceId);
  }

  /** Switches the active microphone without republishing. */
  async setMicrophoneDevice(deviceId: string): Promise<void> {
    await this.adapter.setDevice('audioinput', deviceId);
  }

  /**
   * Sends a small payload to all participants (or specific ones, if the
   * underlying SFU adapter supports targeting). Needs the token's
   * `publishData` grant — throws PERMISSION_DENIED otherwise.
   */
  async sendData(payload: string | Uint8Array): Promise<void> {
    // rewrap into a plain ArrayBuffer-backed Uint8Array so callers don't
    // have to think about ArrayBuffer vs SharedArrayBuffer generics
    const bytes = typeof payload === 'string' ? new TextEncoder().encode(payload) : new Uint8Array(payload);
    await this.adapter.sendData(bytes);
  }

  /** Leaves the room, stops local tracks, and closes the underlying connection. */
  async leave(): Promise<void> {
    await this.adapter.disconnect();
  }
}
