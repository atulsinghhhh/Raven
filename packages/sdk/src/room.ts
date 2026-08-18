import { RTCError } from './errors';
import { TypedEventEmitter } from './events';
import { createTelemetryClient, type TelemetryClient } from './internal/telemetry/telemetry-client';
import { detectPlatform } from './internal/telemetry/platform';
import type { Logger } from './logger';
import { LocalParticipant, RemoteParticipant } from './participant';
import type { ConnectionQuality, SFUAdapter, SdkConnectionState } from './internal/sfu/types';
import { LocalTrack, RemoteTrack, type TrackKind, type TrackStats } from './track';
import { SDK_VERSION } from './version';

export type ConnectionState = SdkConnectionState;

/**
 * Safe, non-secret diagnostic snapshot (Phase 9 spec §12) —
 * `iceConnectionState`/`signalingState` are `undefined` when the
 * underlying SFU adapter doesn't expose them (currently true for the
 * LiveKit adapter — see docs/sdk.md#known-limitations); never fabricated.
 */
export interface ConnectionDiagnostics {
  connectionState: ConnectionState;
  iceConnectionState?: string;
  signalingState?: string;
  reconnectCount: number;
  sdkVersion: string;
  platform: string;
  browser: string;
}

/**
 * Live media-quality stats — deliberately a separate, `async` method from
 * `getDiagnostics()` rather than a field added to it. `getDiagnostics()`
 * is synchronous and cheap by design (safe to call from anywhere, any
 * time); collecting real WebRTC stats is neither — it needs at least one
 * round trip through the browser's stats API per track, and per-track
 * numbers don't collapse into one flat object without losing the thing
 * that made them useful in a multi-participant room.
 */
export interface ConnectionStats {
  connectionState: ConnectionState;
  /** The SFU's own read on connection health — see `ConnectionQuality`. */
  connectionQuality: ConnectionQuality;
  /** One entry per track this side has published. */
  local: TrackStats[];
  /** One entry per track this side has subscribed to, across every remote participant. */
  remote: TrackStats[];
}

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
  /** Phase 11 addition — a remote participant muted/unmuted a track they already published. */
  trackMuted: (kind: TrackKind, participant: RemoteParticipant) => void;
  trackUnmuted: (kind: TrackKind, participant: RemoteParticipant) => void;
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
  /** Stable for this connection's whole lifetime — the ID to hand a developer for debugging (Phase 9 spec §8). */
  readonly connectionId: string;
  readonly localParticipant: LocalParticipant;
  private readonly adapter: SFUAdapter;
  private readonly logger: Logger;
  private readonly telemetry: TelemetryClient;
  private reconnectCount = 0;
  private statsTimer?: ReturnType<typeof setInterval>;

  /**
   * How often the stats monitor samples and reports. Frequent enough that
   * a dashboard viewing "now" isn't looking at stale numbers; infrequent
   * enough that it isn't a meaningful load on the telemetry endpoint
   * across a call with dozens of participants each doing this.
   */
  private static readonly STATS_INTERVAL_MS = 5_000;

  /** @internal use `client.join(roomId)` — the telemetry client defaults to a no-op so tests/advanced setups can construct a Room directly without wiring one up. */
  constructor(
    adapter: SFUAdapter,
    roomId: string,
    logger: Logger,
    telemetry: TelemetryClient = createTelemetryClient({ enabled: false, token: '', sdkVersion: SDK_VERSION, logger }),
  ) {
    super();
    this.adapter = adapter;
    this.roomId = roomId;
    this.logger = logger;
    this.telemetry = telemetry;
    this.connectionId = telemetry.connectionId;
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
        if (prevState === 'reconnecting') {
          this.reconnectCount++;
          this.telemetry.send('reconnected');
          this.emit('reconnected');
        } else {
          this.telemetry.send('connected');
          this.emit('connected');
        }
        this.startStatsMonitor();
      } else if (state === 'reconnecting' && prevState !== 'reconnecting') {
        this.telemetry.send('reconnecting');
        this.emit('reconnecting');
      } else if (state === 'disconnected' || state === 'failed') {
        this.stopStatsMonitor();
        this.telemetry.send(state === 'failed' ? 'connection_failed' : 'disconnected');
        this.emit('disconnected');
        if (state === 'failed') {
          const error = new RTCError('CONNECTION_FAILED', 'Connection failed after exhausting reconnect attempts');
          this.telemetry.send('error', { code: error.code, message: error.message });
          this.emit('error', error);
        }
      }

      prevState = state;
    });

    this.adapter.on('participantJoined', (participant) => {
      this.telemetry.send('participant_joined', { participantIdentity: participant.identity });
      this.emit('participantJoined', participant);
    });
    this.adapter.on('participantLeft', (participant) => {
      this.telemetry.send('participant_left', { participantIdentity: participant.identity });
      this.emit('participantLeft', participant);
    });
    this.adapter.on('trackPublished', (kind, participant) => this.emit('trackPublished', kind, participant));
    this.adapter.on('trackUnpublished', (kind, participant) => this.emit('trackUnpublished', kind, participant));
    this.adapter.on('trackSubscribed', (track, participant) => this.emit('trackSubscribed', track, participant));
    this.adapter.on('trackUnsubscribed', (track, participant) => this.emit('trackUnsubscribed', track, participant));
    this.adapter.on('trackMuted', (kind, participant) => this.emit('trackMuted', kind, participant));
    this.adapter.on('trackUnmuted', (kind, participant) => this.emit('trackUnmuted', kind, participant));
    this.adapter.on('localTrackPublished', (track) => {
      this.telemetry.send('track_published', { kind: track.kind });
      this.emit('localTrackPublished', track);
    });
    this.adapter.on('localTrackUnpublished', (track) => {
      this.telemetry.send('track_unpublished', { kind: track.kind });
      this.emit('localTrackUnpublished', track);
    });
    this.adapter.on('dataReceived', (payload, participant) => this.emit('dataReceived', payload, participant));
    this.adapter.on('mediaError', (error) => {
      this.logger.warn('media device error', error.message);
      const rtcError = new RTCError('MEDIA_ERROR', error.message, error);
      this.telemetry.send('error', { code: rtcError.code, message: rtcError.message });
      this.emit('error', rtcError);
    });
  }

  /**
   * A safe, non-secret diagnostic snapshot for support/debugging (Phase 9
   * spec §12) — never a token, never a secret, safe to print or attach to
   * a bug report as-is.
   */
  getDiagnostics(): ConnectionDiagnostics {
    const { platform, browser } = detectPlatform();
    return {
      connectionState: this.connectionState,
      iceConnectionState: undefined,
      signalingState: undefined,
      reconnectCount: this.reconnectCount,
      sdkVersion: SDK_VERSION,
      platform,
      browser,
    };
  }

  /**
   * Live media-quality stats for every published and subscribed track —
   * RTT, jitter, packet loss, bitrate, codec, resolution/fps, plus the
   * SFU's own connection-quality read. See `ConnectionStats` for why this
   * is separate from `getDiagnostics()`.
   *
   * Safe to call at any time, including before anything has been
   * published or subscribed — `local`/`remote` are simply empty then, not
   * an error.
   */
  async getConnectionStats(): Promise<ConnectionStats> {
    const localTracks = this.localParticipant.tracks;
    const remoteTracks = this.remoteParticipants.flatMap((participant) => participant.tracks);

    const [local, remote] = await Promise.all([
      Promise.all(localTracks.map((track) => track.getStats())),
      Promise.all(remoteTracks.map((track) => track.getStats())),
    ]);

    return {
      connectionState: this.connectionState,
      connectionQuality: this.adapter.getConnectionQuality(),
      local: local.filter((stats): stats is TrackStats => stats !== undefined),
      remote: remote.filter((stats): stats is TrackStats => stats !== undefined),
    };
  }

  /**
   * Polls `getConnectionStats()` on an interval and reports it as
   * telemetry, so the dashboard's RTC view (spec §23) has numbers to show
   * without every developer wiring this up themselves. Best-effort like
   * every other telemetry event here: a failure is swallowed rather than
   * surfaced, since a stats-collection hiccup is not a reason to disrupt
   * the call it's describing.
   */
  private startStatsMonitor(): void {
    if (this.statsTimer) {
      return;
    }
    this.statsTimer = setInterval(() => {
      this.getConnectionStats()
        .then((stats) => this.telemetry.send('stats', stats as unknown as Record<string, unknown>))
        .catch(() => {
          // Deliberately silent — see the method doc.
        });
    }, Room.STATS_INTERVAL_MS);
  }

  private stopStatsMonitor(): void {
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = undefined;
    }
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
   * Switches the audio output ("speaker") device for this room's remote
   * audio elements — Phase 11 addition. Not universally supported (Safari
   * lacks `HTMLMediaElement.setSinkId`); throws `DEVICE_NOT_FOUND` on
   * browsers that don't implement it, rather than silently no-op-ing.
   */
  async setSpeakerDevice(deviceId: string): Promise<void> {
    if (typeof document !== 'undefined') {
      const probe = document.createElement('audio') as HTMLAudioElement & { setSinkId?: unknown };
      if (typeof probe.setSinkId !== 'function') {
        throw new RTCError('DEVICE_NOT_FOUND', "This browser doesn't support selecting an audio output device (no setSinkId)");
      }
    }
    await this.adapter.setDevice('audiooutput', deviceId);
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
    this.stopStatsMonitor();
    await this.adapter.disconnect();
  }
}
