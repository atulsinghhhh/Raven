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
 * A diagnostic snapshot that's safe to paste straight into a bug report.
 * No tokens, no secrets, nothing sensitive.
 *
 * Anything we don't know comes back `undefined`; nothing here is guessed.
 * `iceConnectionState` and `signalingState` were always `undefined` under
 * the LiveKit adapter, which never exposed them. The native adapter does,
 * so they now carry the states that actually explain a failed connection.
 */
export interface ConnectionDiagnostics {
  connectionState: ConnectionState;
  iceConnectionState?: string;
  signalingState?: string;
  /**
   * What the SFU makes of this connection. Worth sitting next to the local
   * states, because the two can disagree, and "server says failed, browser
   * says connected" is a diagnosis, not a contradiction.
   */
  remoteIceConnectionState?: string;
  remotePeerConnectionState?: string;
  reconnectCount: number;
  sdkVersion: string;
  platform: string;
  browser: string;
}

/**
 * Live media-quality stats. A separate `async` method rather than another
 * field on `getDiagnostics()`, and that's on purpose. `getDiagnostics()`
 * is synchronous and cheap so you can call it from anywhere at any time.
 * Collecting real WebRTC stats is neither: it costs at least one round
 * trip through the browser's stats API per track, and squashing per-track
 * numbers into one flat object throws away the very thing that made them
 * useful in a room full of people.
 */
export interface ConnectionStats {
  connectionState: ConnectionState;
  /** The SFU's own read on connection health. See `ConnectionQuality`. */
  connectionQuality: ConnectionQuality;
  /** One entry per track this side has published. */
  local: TrackStats[];
  /** One entry per subscribed track, across all remote participants. */
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
  /** Phase 11 addition. A remote participant muted or unmuted a track they'd already published. */
  trackMuted: (kind: TrackKind, participant: RemoteParticipant) => void;
  trackUnmuted: (kind: TrackKind, participant: RemoteParticipant) => void;
  localTrackPublished: (track: LocalTrack) => void;
  localTrackUnpublished: (track: LocalTrack) => void;
  dataReceived: (payload: Uint8Array, participant?: RemoteParticipant) => void;
  error: (error: RTCError) => void;
}

/**
 * A joined room. You get one from `client.join(roomId)`; don't build it
 * yourself. It owns participant and track state plus every room-scoped
 * action. No SDP, ICE candidates or RTCPeerConnection leak out here.
 */
export class Room extends TypedEventEmitter<RoomEventMap> {
  readonly roomId: string;
  /** Stable for the whole life of this connection. This is the id to quote in a bug report (Phase 9 spec §8). */
  readonly connectionId: string;
  readonly localParticipant: LocalParticipant;
  private readonly adapter: SFUAdapter;
  private readonly logger: Logger;
  private readonly telemetry: TelemetryClient;
  private reconnectCount = 0;
  private statsTimer?: ReturnType<typeof setInterval>;

  /**
   * How often the stats monitor samples and reports. Often enough that a
   * dashboard showing "now" isn't showing you five minutes ago, rarely
   * enough that it doesn't hammer the telemetry endpoint on a call where
   * dozens of participants are all doing exactly this.
   */
  private static readonly STATS_INTERVAL_MS = 5_000;

  /** @internal Use `client.join(roomId)`. The telemetry client defaults to a no-op, so tests and advanced setups can build a Room directly without wiring one up. */
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
   * A non-secret diagnostic snapshot for support and debugging.
   *
   * Synchronous and cheap by design, so you can call it from anywhere at
   * any time, error handlers included. Live media stats are a separate
   * `async` call; see `getConnectionStats()`.
   */
  getDiagnostics(): ConnectionDiagnostics {
    const { platform, browser } = detectPlatform();
    const remote = this.adapter.getRemoteConnectionState?.() ?? {};
    return {
      connectionState: this.connectionState,
      iceConnectionState: this.adapter.getIceConnectionState?.(),
      signalingState: this.adapter.getSignalingState?.(),
      remoteIceConnectionState: remote.iceState,
      remotePeerConnectionState: remote.peerState,
      reconnectCount: this.reconnectCount,
      sdkVersion: SDK_VERSION,
      platform,
      browser,
    };
  }

  /**
   * Live media-quality stats for every published and subscribed track.
   * RTT, jitter, packet loss, bitrate, codec, resolution/fps, and the
   * SFU's own connection-quality read. `ConnectionStats` explains why this
   * is kept apart from `getDiagnostics()`.
   *
   * Call it whenever you like, including before anything is published or
   * subscribed. You just get empty `local`/`remote` arrays then, not an
   * error.
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
   * Polls `getConnectionStats()` on a timer and ships the result as
   * telemetry, so the dashboard's RTC view (spec §23) has numbers to show
   * without every developer wiring it up by hand. Best-effort, same as
   * every other telemetry event here: failures get swallowed. A hiccup
   * collecting stats is no reason to disturb the call it's describing.
   */
  private startStatsMonitor(): void {
    if (this.statsTimer) {
      return;
    }
    this.statsTimer = setInterval(() => {
      this.getConnectionStats()
        .then((stats) => this.telemetry.send('stats', stats as unknown as Record<string, unknown>))
        .catch(() => {
          // Silent on purpose. See the method doc.
        });
    }, Room.STATS_INTERVAL_MS);
  }

  private stopStatsMonitor(): void {
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = undefined;
    }
  }

  /** Captures and publishes the camera in one go. Resolves to the published track. */
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

  /**
   * Two events get special treatment here.
   *
   * **`dataReceived`** is what provisions this participant's data channel.
   * The SFU fans data out over each recipient's own channel, and a channel
   * is only created on demand — most calls never send a byte, and an SCTP
   * association for every participant regardless is a cost with nothing
   * behind it. So a page that never called `sendData()` could not
   * *receive* either, which made data one-way in exactly the setup people
   * try first. Subscribing to the event is the signal that one is wanted.
   *
   * **`trackSubscribed`** is replayed for tracks that were already
   * subscribed when the handler was added.
   *
   * Without that, joining a room where somebody is *already* publishing
   * never tells you about them. `client.join()` subscribes to the existing
   * publishers and emits during `connect()`, which is before the promise
   * resolves — so by the time a caller has a `Room` to call `.on()` on,
   * the events are gone. Media arrives and decodes; the application simply
   * never hears about it and renders nothing. That is the normal case for
   * a live stream, where every viewer joins a broadcast already in
   * progress, and the shape the documented example uses:
   *
   * ```ts
   * const room = await client.join(name);           // subscribes here
   * room.on('trackSubscribed', (t) => …);           // …handler added here
   * ```
   *
   * Only tracks a handler demonstrably missed are replayed — the ones
   * subscribed before it was added — so a handler registered up front
   * still sees each track exactly once, and adding a second handler later
   * cannot double-deliver to the first. Delivery is deferred to a
   * microtask so `.on()` stays a plain registration call and never
   * re-enters the caller before it has returned. `Promise.resolve()`
   * rather than `queueMicrotask`, so this holds on every engine the SDK
   * ships to, React Native's included.
   */
  on<E extends keyof RoomEventMap>(event: E, handler: RoomEventMap[E]): this {
    if (event === 'dataReceived') {
      this.adapter.ensureDataChannel?.();
    }

    if (event === 'trackSubscribed') {
      const missed = this.remoteParticipants.flatMap((participant) =>
        participant.tracks.map((track) => ({ track, participant })),
      );
      if (missed.length > 0) {
        const subscribed = handler as RoomEventMap['trackSubscribed'];
        void Promise.resolve().then(() => {
          for (const { track, participant } of missed) {
            subscribed(track, participant);
          }
        });
      }
    }

    return super.on(event, handler);
  }

  /**
   * Publishes a track you made with `client.createCameraTrack()` and
   * friends, or one you wrapped with `client.createCustomTrack()`.
   */
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
   * audio elements. Phase 11 addition. Not supported everywhere: Safari
   * has no `HTMLMediaElement.setSinkId`. Browsers that don't implement it
   * get a `DEVICE_NOT_FOUND` throw instead of a silent no-op.
   */
  async setSpeakerDevice(deviceId: string): Promise<void> {
    if (typeof document !== 'undefined') {
      const probe = document.createElement('audio') as HTMLAudioElement & { setSinkId?: unknown };
      if (typeof probe.setSinkId !== 'function') {
        throw new RTCError(
          'DEVICE_NOT_FOUND',
          "This browser doesn't support selecting an audio output device (no setSinkId)",
        );
      }
    }
    await this.adapter.setDevice('audiooutput', deviceId);
  }

  /**
   * Sends a small payload to everyone, or to specific people if the
   * underlying SFU adapter supports targeting. Requires the token's
   * `publishData` grant; throws PERMISSION_DENIED without it.
   *
   * Works in an empty room with nothing published. The first call has to
   * negotiate a data channel — one round trip — which this awaits on your
   * behalf; payloads sent while the channel is still opening are queued
   * and go out in order. Rejects with CONNECTION_FAILED if the connection
   * dies before the channel can open, rather than hanging.
   */
  async sendData(payload: string | Uint8Array): Promise<void> {
    // Rewrap as a plain ArrayBuffer-backed Uint8Array, so callers never
    // have to think about ArrayBuffer vs SharedArrayBuffer generics.
    const bytes = typeof payload === 'string' ? new TextEncoder().encode(payload) : new Uint8Array(payload);
    await this.adapter.sendData(bytes);
  }

  /**
   * Resolves once the media connection is genuinely up.
   *
   * # Why this exists
   *
   * `client.join()` resolves when the **control plane** lets you in: room
   * joined, you know who else is here, you can publish. The media
   * connection finishes a moment later, once ICE and DTLS are done, which
   * means `connectionState` sits at `'connecting'` for a short window
   * after `join()` returns. That's the honest shape of an SFU connection,
   * and it's why `'connected'` is an event, not something joining
   * guarantees you.
   *
   * Most callers need none of this. `enableCamera()` and
   * `enableMicrophone()` work fine inside that window, and the `connected`
   * event is what you want driving a UI. This is for code that genuinely
   * has to block: a test, or a flow that mustn't move on until media is
   * live.
   *
   * Resolves straight away if already connected. Rejects on `'failed'` and
   * on timeout, rather than handing back a connection that isn't there.
   *
   * Careful: a subscriber joining a room where nobody is publishing can
   * quite legitimately stay `'connecting'`. With no tracks on either side
   * there's nothing to negotiate, so waiting here times out on a
   * connection that isn't broken at all. Where you can, drive the UI off
   * the `connected` event instead of blocking on this.
   */
  waitUntilConnected(timeoutMs = 15_000): Promise<void> {
    if (this.connectionState === 'connected') {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const settle = (fn: () => void) => {
        clearTimeout(timer);
        this.off('connectionStateChanged', onState);
        fn();
      };

      const onState = (state: ConnectionState) => {
        if (state === 'connected') {
          settle(resolve);
        } else if (state === 'failed') {
          settle(() => reject(new RTCError('CONNECTION_FAILED', 'The connection failed while waiting for it')));
        }
      };

      const timer = setTimeout(() => {
        settle(() =>
          reject(
            new RTCError(
              'CONNECTION_FAILED',
              `Still ${this.connectionState} after ${timeoutMs}ms; the media connection did not establish`,
            ),
          ),
        );
      }, timeoutMs);

      this.on('connectionStateChanged', onState);
    });
  }

  /** Leaves the room, stops local tracks and closes the underlying connection. */
  async leave(): Promise<void> {
    this.stopStatsMonitor();
    await this.adapter.disconnect();
  }
}
