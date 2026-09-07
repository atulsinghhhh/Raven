import { assertTokenMatchesRoom, validateConfig, type ResolvedRTCClientConfig, type RTCClientConfig } from './config';
import { RTCError } from './errors';
import { createLogger, type Logger } from './logger';
import { listDevices } from './internal/devices/enumerate';
import {
  createCameraTrack,
  createMicrophoneTrack,
  createScreenShareTrack,
} from './internal/media/capture';
import { RavenAdapter } from './internal/sfu/raven-adapter';
import type { DeviceInfo, DeviceKind, SFUAdapter } from './internal/sfu/types';
import { createTelemetryClient } from './internal/telemetry/telemetry-client';
import { Room, type ConnectionDiagnostics } from './room';
import { LocalTrack } from './track';
import { SDK_VERSION } from './version';

type AdapterFactory = (logger: Logger, autoReconnect: boolean) => SFUAdapter;

const defaultAdapterFactory: AdapterFactory = (logger, autoReconnect) => new RavenAdapter(logger, autoReconnect);

/**
 * The SDK's entry point. Holds your RTC token/endpoint and lets you join a
 * room; all per-room state and actions live on the `Room` it returns.
 */
export class RTCClient {
  private readonly config: ResolvedRTCClientConfig;
  private readonly logger: Logger;
  private readonly adapterFactory: AdapterFactory;
  private currentRoom?: Room;

  /**
   * @internal use `createRTCClient(config)` instead. Second param only
   * exists so tests can inject a fake SFUAdapter without a real
   * browser/WebRTC stack — not part of the public config.
   */
  constructor(config: ResolvedRTCClientConfig, adapterFactory: AdapterFactory = defaultAdapterFactory) {
    this.config = config;
    this.logger = createLogger(config.logLevel);
    this.adapterFactory = adapterFactory;
  }

  /**
   * Joins the room this client's token was minted for. `roomId` must match
   * that room — passing a different one throws `ROOM_NOT_FOUND` immediately,
   * before attempting any connection.
   */
  async join(roomId: string): Promise<Room> {
    assertTokenMatchesRoom(this.config.token, roomId);
    this.logger.info('joining room', roomId);

    const telemetry = createTelemetryClient({
      enabled: this.config.telemetry,
      telemetryUrl: this.config.telemetryUrl,
      token: this.config.token,
      sdkVersion: SDK_VERSION,
      logger: this.logger,
    });
    telemetry.send('connection_started');

    const adapter = this.adapterFactory(this.logger, this.config.autoReconnect);
    const room = new Room(adapter, roomId, this.logger, telemetry);

    try {
      await adapter.connect(this.config.endpoint, this.config.token, this.config.iceServers);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = error instanceof RTCError ? error.code : 'CONNECTION_FAILED';
      telemetry.send('error', { code, message });
      telemetry.send('connection_failed');
      throw error;
    }

    this.currentRoom = room;
    return room;
  }

  /** Leaves the most recently joined room, if any. Equivalent to calling `.leave()` on that `Room`. */
  async leave(): Promise<void> {
    await this.currentRoom?.leave();
    this.currentRoom = undefined;
  }

  /** Captures a camera track without joining/publishing — pair with `room.publish(track)`. */
  async createCameraTrack(deviceId?: string): Promise<LocalTrack> {
    return createCameraTrack(deviceId ? { deviceId } : {});
  }

  /** Captures a microphone track without joining/publishing — pair with `room.publish(track)`. */
  async createMicrophoneTrack(deviceId?: string): Promise<LocalTrack> {
    return createMicrophoneTrack(deviceId ? { deviceId } : {});
  }

  /** Captures a screen-share track without joining/publishing — pair with `room.publish(track)`. */
  async createScreenShareTrack(): Promise<LocalTrack> {
    return createScreenShareTrack();
  }

  /** Lists available devices. Labels are populated only once permission has been granted at least once. */
  async getDevices(kind?: DeviceKind): Promise<DeviceInfo[]> {
    return listDevices(kind);
  }

  /**
   * Subscribes to device connect/disconnect (Phase 11 addition) — e.g. a
   * USB webcam being plugged in or unplugged. Returns an unsubscribe
   * function. A no-op (immediately-callable unsubscribe) in environments
   * without `navigator.mediaDevices` rather than throwing, since this is
   * an optional convenience, not a required capability.
   */
  onDeviceChange(callback: () => void): () => void {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) {
      return () => {};
    }
    navigator.mediaDevices.addEventListener('devicechange', callback);
    return () => navigator.mediaDevices.removeEventListener('devicechange', callback);
  }

  /** Switches the active camera on the currently joined room. */
  async setCamera(deviceId: string): Promise<void> {
    if (!this.currentRoom) {
      throw new RTCError('CONNECTION_FAILED', 'setCamera() requires an active room — call join() first');
    }
    await this.currentRoom.setCameraDevice(deviceId);
  }

  /** Switches the active microphone on the currently joined room. */
  async setMicrophone(deviceId: string): Promise<void> {
    if (!this.currentRoom) {
      throw new RTCError('CONNECTION_FAILED', 'setMicrophone() requires an active room — call join() first');
    }
    await this.currentRoom.setMicrophoneDevice(deviceId);
  }

  /** Safe diagnostic snapshot of the currently joined room — see `Room.getDiagnostics()`. */
  getDiagnostics(): ConnectionDiagnostics {
    if (!this.currentRoom) {
      throw new RTCError('CONNECTION_FAILED', 'getDiagnostics() requires an active room — call join() first');
    }
    return this.currentRoom.getDiagnostics();
  }
}

/**
 * Creates an RTC client from a token minted by your backend. `token` and
 * `endpoint` are the `token` and `endpoint` fields from that same
 * mint response — don't construct them by hand, and don't mint a token
 * in the browser.
 */
export function createRTCClient(config: RTCClientConfig): RTCClient {
  const resolved = validateConfig(config);
  return new RTCClient(resolved);
}
