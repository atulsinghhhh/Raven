import {
  ConnectionError,
  ConnectionErrorReason,
  ConnectionState as LKConnectionState,
  Room as LKRoom,
  RoomEvent,
  Track as LKTrack,
  type LocalParticipant as LKLocalParticipant,
  type LocalTrackPublication as LKLocalTrackPublication,
  type RemoteParticipant as LKRemoteParticipant,
  type RemoteTrack as LKRemoteTrack,
  type RemoteTrackPublication as LKRemoteTrackPublication,
  type ReconnectPolicy,
} from 'livekit-client';
import { RTCError } from '../../errors';
import type { Logger } from '../../logger';
import { LocalParticipant, RemoteParticipant } from '../../participant';
import { LocalTrack, RemoteTrack, type TrackKind } from '../../track';
import { toMediaError } from '../media/errors';
import { TypedEventEmitter } from '../../events';
import type { DeviceInfo, DeviceKind, SFUAdapter, SFUAdapterEventMap, SdkConnectionState } from './types';

/** Stops retrying immediately — used when the developer sets `autoReconnect: false`. */
const noRetryPolicy: ReconnectPolicy = { nextRetryDelayInMs: () => null };

function trackKindFromSource(source: LKTrack.Source): TrackKind {
  switch (source) {
    case LKTrack.Source.Camera:
      return 'camera';
    case LKTrack.Source.Microphone:
      return 'microphone';
    case LKTrack.Source.ScreenShare:
    case LKTrack.Source.ScreenShareAudio:
      return 'screenShare';
    default:
      return 'unknown';
  }
}

function mapConnectionState(state: LKConnectionState): SdkConnectionState {
  switch (state) {
    case LKConnectionState.Disconnected:
      return 'disconnected';
    case LKConnectionState.Connecting:
      return 'connecting';
    case LKConnectionState.Connected:
      return 'connected';
    case LKConnectionState.Reconnecting:
    case LKConnectionState.SignalReconnecting:
      return 'reconnecting';
    default:
      return 'disconnected';
  }
}

function mapConnectError(error: unknown): RTCError {
  if (error instanceof ConnectionError) {
    switch (error.reason) {
      case ConnectionErrorReason.NotAllowed:
        return new RTCError('INVALID_TOKEN', error.message, error);
      case ConnectionErrorReason.Timeout:
        return new RTCError('TIMEOUT', error.message, error);
      case ConnectionErrorReason.ServerUnreachable:
        return new RTCError('NETWORK_ERROR', error.message, error);
      case ConnectionErrorReason.WebSocket:
        return new RTCError('SIGNALING_ERROR', error.message, error);
      default:
        return new RTCError('CONNECTION_FAILED', error.message, error);
    }
  }
  return new RTCError('CONNECTION_FAILED', error instanceof Error ? error.message : 'Failed to connect', error);
}

/**
 * Adapts livekit-client's Room to the SDK's own SFUAdapter surface (Phase 6
 * spec §24). This is the only file that imports livekit-client's Room type
 * directly — Room.ts and Client.ts only ever see SFUAdapter.
 */
export class LiveKitAdapter extends TypedEventEmitter<SFUAdapterEventMap> implements SFUAdapter {
  private readonly lkRoom: LKRoom;
  private readonly logger: Logger;
  private intentionalDisconnect = false;
  private wasReconnecting = false;

  readonly localParticipant: LocalParticipant;
  readonly remoteParticipants = new Map<string, RemoteParticipant>();

  private readonly localTrackWrappers = new WeakMap<LKLocalTrackPublication, LocalTrack>();
  private readonly remoteTrackWrappers = new WeakMap<LKRemoteTrack, RemoteTrack>();

  private _connectionState: SdkConnectionState = 'disconnected';

  constructor(logger: Logger, autoReconnect: boolean) {
    super();
    this.logger = logger;
    this.lkRoom = new LKRoom({
      reconnectPolicy: autoReconnect ? undefined : noRetryPolicy,
    });
    this.localParticipant = new LocalParticipant(this.lkRoom.localParticipant.identity || '');
    this.wireEvents();
  }

  get connectionState(): SdkConnectionState {
    return this._connectionState;
  }

  private setConnectionState(state: SdkConnectionState): void {
    if (this._connectionState === state) return;
    this._connectionState = state;
    this.emit('connectionStateChanged', state);
  }

  private wireEvents(): void {
    const room = this.lkRoom;

    room.on(RoomEvent.ConnectionStateChanged, (state) => {
      const mapped = mapConnectionState(state);
      if (mapped === 'reconnecting') this.wasReconnecting = true;
      // 'disconnected' is handled by the Disconnected listener below, which
      // has the extra context (intentional vs. reconnect-exhausted) needed
      // to decide between our 'disconnected' and 'failed' states.
      if (mapped !== 'disconnected') this.setConnectionState(mapped);
    });

    room.on(RoomEvent.Disconnected, () => {
      const failed = !this.intentionalDisconnect && this.wasReconnecting;
      this.setConnectionState(failed ? 'failed' : 'disconnected');
      this.wasReconnecting = false;
      this.intentionalDisconnect = false;
    });

    room.on(RoomEvent.ParticipantConnected, (lkParticipant) => {
      const participant = new RemoteParticipant(lkParticipant.identity, lkParticipant.metadata);
      this.remoteParticipants.set(lkParticipant.identity, participant);
      this.emit('participantJoined', participant);
    });

    room.on(RoomEvent.ParticipantDisconnected, (lkParticipant) => {
      const participant = this.remoteParticipants.get(lkParticipant.identity);
      this.remoteParticipants.delete(lkParticipant.identity);
      if (participant) this.emit('participantLeft', participant);
    });

    room.on(RoomEvent.TrackPublished, (publication, lkParticipant) => {
      const participant = this.remoteParticipants.get(lkParticipant.identity);
      if (participant) this.emit('trackPublished', trackKindFromSource(publication.source), participant);
    });

    room.on(RoomEvent.TrackUnpublished, (publication, lkParticipant) => {
      const participant = this.remoteParticipants.get(lkParticipant.identity);
      if (participant) this.emit('trackUnpublished', trackKindFromSource(publication.source), participant);
    });

    room.on(RoomEvent.TrackSubscribed, (lkTrack, publication, lkParticipant) => {
      const participant = this.remoteParticipants.get(lkParticipant.identity);
      if (!participant) return;
      const track = new RemoteTrack(lkTrack, trackKindFromSource(lkTrack.source));
      this.remoteTrackWrappers.set(lkTrack, track);
      participant.tracks.push(track);
      this.emit('trackSubscribed', track, participant);
    });

    room.on(RoomEvent.TrackUnsubscribed, (lkTrack, publication, lkParticipant) => {
      const participant = this.remoteParticipants.get(lkParticipant.identity);
      const track = this.remoteTrackWrappers.get(lkTrack);
      if (!participant || !track) return;
      const index = participant.tracks.indexOf(track);
      if (index !== -1) participant.tracks.splice(index, 1);
      this.remoteTrackWrappers.delete(lkTrack);
      this.emit('trackUnsubscribed', track, participant);
    });

    room.on(RoomEvent.LocalTrackPublished, (publication) => {
      // enableCamera()/enableMicrophone()/enableScreenShare() may have
      // already wrapped this publication (trackFromPublication) before this
      // event fires — reuse that wrapper rather than creating a duplicate.
      const track = this.localTrackWrappers.get(publication) ?? new LocalTrack(assertLocalTrack(publication), trackKindFromSource(publication.source));
      this.localTrackWrappers.set(publication, track);
      if (!this.localParticipant.tracks.includes(track)) this.localParticipant.tracks.push(track);
      this.emit('localTrackPublished', track);
    });

    room.on(RoomEvent.LocalTrackUnpublished, (publication) => {
      const track = this.localTrackWrappers.get(publication);
      if (!track) return;
      const index = this.localParticipant.tracks.indexOf(track);
      if (index !== -1) this.localParticipant.tracks.splice(index, 1);
      this.localTrackWrappers.delete(publication);
      this.emit('localTrackUnpublished', track);
    });

    room.on(RoomEvent.DataReceived, (payload, lkParticipant) => {
      const participant = lkParticipant ? this.remoteParticipants.get(lkParticipant.identity) : undefined;
      this.emit('dataReceived', payload, participant);
    });

    room.on(RoomEvent.MediaDevicesError, (error) => {
      this.emit('mediaError', error);
    });
  }

  /**
   * RoomEvent.ParticipantConnected/TrackSubscribed only fire for
   * participants/tracks that arrive *after* our listeners are attached —
   * livekit-client has already populated room.remoteParticipants (and each
   * participant's already-subscribed tracks) by the time connect() resolves
   * for anyone who joined before us. Without this, a participant who joined
   * first would never appear on a participant who joins second.
   */
  private bootstrapExistingParticipants(): void {
    for (const lkParticipant of this.lkRoom.remoteParticipants.values()) {
      const participant = new RemoteParticipant(lkParticipant.identity, lkParticipant.metadata);
      this.remoteParticipants.set(lkParticipant.identity, participant);
      this.emit('participantJoined', participant);

      for (const publication of lkParticipant.trackPublications.values()) {
        if (!publication.track) continue;
        const track = new RemoteTrack(publication.track, trackKindFromSource(publication.source));
        this.remoteTrackWrappers.set(publication.track, track);
        participant.tracks.push(track);
        this.emit('trackSubscribed', track, participant);
      }
    }
  }

  async connect(endpoint: string, token: string, iceServers?: RTCIceServer[]): Promise<void> {
    this.setConnectionState('connecting');
    try {
      await this.lkRoom.connect(endpoint, token, iceServers ? { rtcConfig: { iceServers } } : undefined);
      this.localParticipant._setIdentity(this.lkRoom.localParticipant.identity);
      this.bootstrapExistingParticipants();
      this.setConnectionState('connected');
    } catch (error) {
      this.setConnectionState('failed');
      throw mapConnectError(error);
    }
  }

  async disconnect(): Promise<void> {
    this.intentionalDisconnect = true;
    await this.lkRoom.disconnect();
  }

  async enableCamera(enabled: boolean): Promise<LocalTrack | undefined> {
    try {
      const publication = await this.lkRoom.localParticipant.setCameraEnabled(enabled);
      return publication?.track ? this.trackFromPublication(publication) : undefined;
    } catch (error) {
      throw toMediaError(error, 'camera');
    }
  }

  async enableMicrophone(enabled: boolean): Promise<LocalTrack | undefined> {
    try {
      const publication = await this.lkRoom.localParticipant.setMicrophoneEnabled(enabled);
      return publication?.track ? this.trackFromPublication(publication) : undefined;
    } catch (error) {
      throw toMediaError(error, 'microphone');
    }
  }

  async enableScreenShare(enabled: boolean): Promise<LocalTrack | undefined> {
    try {
      const publication = await this.lkRoom.localParticipant.setScreenShareEnabled(enabled);
      return publication?.track ? this.trackFromPublication(publication) : undefined;
    } catch (error) {
      throw toMediaError(error, 'screenShare');
    }
  }

  private trackFromPublication(publication: LKLocalTrackPublication): LocalTrack {
    const existing = this.localTrackWrappers.get(publication);
    if (existing) return existing;
    // RoomEvent.LocalTrackPublished usually wraps first, but guard for the
    // rare case this resolves before that listener has run.
    const track = new LocalTrack(publication.track!, trackKindFromSource(publication.source));
    this.localTrackWrappers.set(publication, track);
    return track;
  }

  async publish(track: LocalTrack): Promise<void> {
    try {
      await this.lkRoom.localParticipant.publishTrack(track.mediaStreamTrack);
    } catch (error) {
      throw new RTCError('MEDIA_ERROR', 'Failed to publish track', error);
    }
  }

  async unpublish(track: LocalTrack): Promise<void> {
    await this.lkRoom.localParticipant.unpublishTrack(track.mediaStreamTrack);
  }

  async sendData(payload: Uint8Array<ArrayBuffer>): Promise<void> {
    try {
      await this.lkRoom.localParticipant.publishData(payload);
    } catch (error) {
      throw new RTCError('PERMISSION_DENIED', 'Failed to send data — check the token grants publishData', error);
    }
  }

  async getDevices(kind?: DeviceKind): Promise<DeviceInfo[]> {
    const infos = await LKRoom.getLocalDevices(kind, true);
    return infos.map((info) => ({ deviceId: info.deviceId, label: info.label, kind: info.kind as DeviceKind }));
  }

  async setDevice(kind: 'videoinput' | 'audioinput', deviceId: string): Promise<void> {
    await this.lkRoom.switchActiveDevice(kind, deviceId);
  }
}

function assertLocalTrack(publication: LKLocalTrackPublication) {
  if (!publication.track) {
    throw new RTCError('MEDIA_ERROR', 'Track publication has no local track');
  }
  return publication.track;
}
