import { assertTokenMatchesRoom, validateConfig, type ResolvedRTCClientConfig, type RTCClientConfig } from './config';
import { RTCError } from './errors';
import { createLogger, type Logger } from './logger';
import { listDevices } from './internal/devices/enumerate';
import { createCameraTrack } from './internal/media/camera';
import { createMicrophoneTrack } from './internal/media/microphone';
import { createScreenShareTrack } from './internal/media/screen-share';
import { LiveKitAdapter } from './internal/sfu/livekit-adapter';
import type { DeviceInfo, DeviceKind, SFUAdapter } from './internal/sfu/types';
import { Room } from './room';
import { LocalTrack } from './track';

type AdapterFactory = (logger: Logger, autoReconnect: boolean) => SFUAdapter;

const defaultAdapterFactory: AdapterFactory = (logger, autoReconnect) => new LiveKitAdapter(logger, autoReconnect);

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
   * @internal use `createRTCClient(config)` instead. The second parameter
   * exists only so unit tests can inject a fake SFUAdapter without a real
   * browser/WebRTC stack — never part of the public config shape.
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

    const adapter = this.adapterFactory(this.logger, this.config.autoReconnect);
    const room = new Room(adapter, roomId, this.logger);
    await adapter.connect(this.config.endpoint, this.config.token, this.config.iceServers);

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
    return createCameraTrack(deviceId);
  }

  /** Captures a microphone track without joining/publishing — pair with `room.publish(track)`. */
  async createMicrophoneTrack(deviceId?: string): Promise<LocalTrack> {
    return createMicrophoneTrack(deviceId);
  }

  /** Captures a screen-share track without joining/publishing — pair with `room.publish(track)`. */
  async createScreenShareTrack(): Promise<LocalTrack> {
    return createScreenShareTrack();
  }

  /** Lists available devices. Labels are populated only once permission has been granted at least once. */
  async getDevices(kind?: DeviceKind): Promise<DeviceInfo[]> {
    return listDevices(kind);
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
}

/**
 * Creates an RTC client from a token minted by your backend. See
 * docs/sdk.md#authentication — `token` and `endpoint` are the `token` and
 * `livekitUrl` fields from that same token-mint response; never construct
 * either by hand, and never mint a token in the browser.
 */
export function createRTCClient(config: RTCClientConfig): RTCClient {
  const resolved = validateConfig(config);
  return new RTCClient(resolved);
}
