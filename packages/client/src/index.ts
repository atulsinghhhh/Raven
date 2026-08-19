import { createRTCClient, type RTCClient, type RTCClientConfig, type Room } from '@raven/rtc';
import { createChatClient, type ChatClient, type ChatClientConfig } from '@raven/chat';
import { LiveStream } from './live/live-stream';
import type { LiveStreamCredentials } from './live/types';

export type { Raven as RavenClient };

/**
 * Everything `new Raven(...)` accepts.
 *
 * RTC and chat credentials are independent, and so are the two halves of
 * this config — supply whichever planes your app actually uses. All three
 * shapes are valid:
 *
 * ```ts
 * new Raven({ token, endpoint });                                  // calls only
 * new Raven({ chatToken, chatApiUrl });                            // messaging only
 * new Raven({ token, endpoint, chatToken, chatApiUrl });           // both
 * ```
 *
 * Every value here comes from your backend's token-mint response — none
 * of them should be hand-constructed.
 */
export interface RavenConfig {
  /**
   * RTC token from your backend. Never mint this in the browser.
   * Optional together with `endpoint` — omit both for a messaging-only app.
   */
  token?: string;
  /** The `endpoint` field from the same mint response. Required whenever `token` is set. */
  endpoint?: string;
  /** The `iceServers` array from the same response — forward it as-is, never hand-construct one. */
  iceServers?: RTCIceServer[];
  /** Defaults to true. Telemetry is best-effort and never blocks a call. */
  telemetry?: boolean;
  telemetryUrl?: string;
  /** Defaults to true. */
  autoReconnect?: boolean;

  /**
   * Chat token from your backend's `POST /v1/chat/tokens`. A separate
   * credential from `token` by design — neither works on the other plane.
   */
  chatToken?: string;
  /**
   * REST base for chat — the `apiUrl` field from the chat-token response.
   * Falls back to `telemetryUrl`, which is the same host in a standard
   * deployment. Required in practice whenever `chatToken` is set: without
   * it (or `chatUrl`) there is nowhere to connect, and `@raven/chat`
   * says so at construction rather than failing later.
   */
  chatApiUrl?: string;
  /** Chat WebSocket URL. Derived from `chatApiUrl` when omitted. */
  chatUrl?: string;
  /**
   * Called shortly before the chat token expires. Return a fresh one and
   * the connection is re-established transparently.
   */
  onChatTokenExpiring?: () => Promise<string> | string;

  logLevel?: RTCClientConfig['logLevel'];
}

/**
 * Raven for the browser, with RTC and chat behind one object.
 *
 * This is a facade, not a third implementation: `raven.rtc` is a real
 * `RTCClient` from `@raven/rtc` and `raven.chat` is a real `ChatClient`
 * from `@raven/chat`. Every method, event, and type documented for those
 * packages applies here unchanged, because they *are* those objects.
 *
 * ```ts
 * const raven = new Raven({ token, endpoint, chatToken, chatApiUrl });
 *
 * const room = await raven.join('room_123');
 * await room.enableCamera();
 *
 * await raven.chat!.connect({ room: 'room_123' });
 * await raven.chat!.sendMessage({ text: 'Hello' });
 * ```
 *
 * **Use `@raven/rtc` directly if you only want calls** — it's ~6 KB
 * gzipped and pulls in no messaging code. This package exists for apps
 * that want both without wiring two clients themselves, and it mirrors
 * the shape `@raven/react-native` already gives mobile, so the same
 * mental model works on both.
 */
export class Raven {
  /** Absent for a messaging-only app — see the constructor. */
  readonly rtc?: RTCClient;
  /** Absent for an RTC-only app — see the constructor. */
  readonly chat?: ChatClient;
  /**
   * Raven Live Streaming. Unlike `rtc`/`chat` above, this never depends
   * on the credentials this `Raven` instance was constructed with — a
   * live stream's host/co-host/viewer tokens are minted per stream, per
   * role, by your backend (`POST /v1/live-streams/:id/hosts` or
   * `.../viewer-tokens`), so `live.join()` is available on every
   * instance regardless of what `new Raven(...)` was given.
   *
   * ```ts
   * const stream = await raven.live.join(credentials);
   * if (stream.isHost) await stream.room.enableCamera();
   * ```
   */
  readonly live: { join(credentials: LiveStreamCredentials): Promise<LiveStream> };

  private currentRoom?: Room;

  constructor(config: RavenConfig) {
    this.live = { join: (credentials) => LiveStream.join(credentials) };

    // One without the other is always a mistake, and failing here beats
    // failing at join() with a confusing connection error.
    if (Boolean(config.token) !== Boolean(config.endpoint)) {
      throw new Error(
        'Raven needs both `token` and `endpoint` for RTC, or neither for a messaging-only app. ' +
          'Both come from the same token-mint response.',
      );
    }

    if (!config.token && !config.chatToken) {
      throw new Error(
        'Raven needs at least one credential: `token` + `endpoint` for calls, `chatToken` for messaging, or both.',
      );
    }

    if (config.token && config.endpoint) {
      this.rtc = createRTCClient({
        token: config.token,
        endpoint: config.endpoint,
        iceServers: config.iceServers,
        telemetry: config.telemetry,
        telemetryUrl: config.telemetryUrl,
        autoReconnect: config.autoReconnect,
        logLevel: config.logLevel,
      });
    }

    if (config.chatToken) {
      this.chat = createChatClient({
        token: config.chatToken,
        apiUrl: config.chatApiUrl ?? config.telemetryUrl,
        chatUrl: config.chatUrl,
        logLevel: config.logLevel,
        onTokenExpiring: config.onChatTokenExpiring,
      } as ChatClientConfig);
    }
  }

  /** True when this instance was given RTC credentials. */
  get hasRtc(): boolean {
    return this.rtc !== undefined;
  }

  /** True when this instance was given a chat token. */
  get hasChat(): boolean {
    return this.chat !== undefined;
  }

  /** The room currently joined, if any. */
  get room(): Room | undefined {
    return this.currentRoom;
  }

  /**
   * Joins a room. Throws immediately, with an error that says why, if
   * this instance has no RTC credentials — rather than failing later as
   * a null reference.
   */
  async join(roomId: string): Promise<Room> {
    if (!this.rtc) {
      throw new Error(
        'This Raven instance has no RTC credentials, so it cannot join a room. ' +
          'Pass `token` and `endpoint` to enable calls, or use `raven.chat` for messaging.',
      );
    }

    this.currentRoom = await this.rtc.join(roomId);
    return this.currentRoom;
  }

  /** Leaves the room, keeping any chat connection open. */
  async leave(): Promise<void> {
    await this.currentRoom?.leave();
    this.currentRoom = undefined;
  }

  /**
   * Tears down everything, including chat. Call this when the feature is
   * going away — `leave()` alone is right when moving between rooms.
   */
  async dispose(): Promise<void> {
    await this.leave();
    await this.chat?.disconnect();
  }
}

/** Functional alias, matching `createRTCClient`/`createChatClient`. */
export function createRaven(config: RavenConfig): Raven {
  return new Raven(config);
}

// Re-exported so an app using this facade doesn't need direct imports
// from the underlying packages for common types.
export type { Room, RTCClient, RTCClientConfig } from '@raven/rtc';
export { RTCError, isRTCError } from '@raven/rtc';
export type { ChatClient, ChatMessage, ChatConnectionState } from '@raven/chat';
export { isRavenChatError } from '@raven/chat';

export { LiveStream, joinLiveStream } from './live/live-stream';
export type { LiveStreamCredentials, LiveStreamRole } from './live/types';
