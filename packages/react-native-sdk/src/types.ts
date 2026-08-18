import type { LogLevel } from '@raven/rtc';
import type { ChatClient } from '@raven/chat';
import type { RavenAppState } from './internal/lifecycle';

/**
 * Everything `new Raven(...)` needs.
 *
 * The RTC fields are the same ones `createRTCClient` takes on web, with
 * the same meanings and the same rule: they all come from your backend's
 * token-mint response, and none of them should be hand-constructed.
 */
export interface RavenConfig {
  /** RTC token from your backend. Never mint this in the app (spec §15). */
  token: string;
  /** The `livekitUrl` field from the same mint response. */
  endpoint: string;
  /** The `iceServers` array from the same response — forward it as-is. */
  iceServers?: RTCIceServer[];
  /** The `telemetryUrl` from the same response. Doubles as the chat REST base if `chatApiUrl` is omitted. */
  telemetryUrl?: string;
  /** Defaults to true. Telemetry is best-effort and never blocks a call. */
  telemetry?: boolean;
  logLevel?: LogLevel;
  /** Defaults to true. */
  autoReconnect?: boolean;

  /**
   * Chat token from your backend's `POST /v1/chat/tokens`. Omit for an
   * RTC-only app — `raven.chat` is simply absent then.
   *
   * This is a *separate* credential from `token` above, by design: the
   * two planes are independent, and neither token works on the other
   * (see docs/chat/overview.md).
   */
  chatToken?: string;
  /** REST base for chat. Defaults to `telemetryUrl`, which is the same host. */
  chatApiUrl?: string;
  /** Chat WebSocket URL. Derived from `chatApiUrl` when omitted. */
  chatUrl?: string;
  /**
   * Called shortly before the chat token expires. Return a fresh one and
   * the SDK reconnects transparently — without this, a long call's chat
   * connection simply closes when the token runs out.
   */
  onChatTokenExpiring?: () => Promise<string> | string;

  /**
   * Set false if your app already owns the audio session. Raven starts
   * one when joining and stops it when leaving otherwise.
   */
  manageAudioSession?: boolean;

  /** Notified when the app moves between foreground and background. */
  onAppStateChange?: (state: RavenAppState) => void;
  /**
   * Fired when connectivity returns *and* the room is disconnected —
   * a hook for showing "reconnecting…" or forcing a rejoin. Requires
   * `@react-native-community/netinfo` to be installed.
   */
  onNetworkReconnect?: () => void;
}

/**
 * The chat surface hanging off `raven.chat`.
 *
 * Structurally this is `@raven/chat`'s `ChatClient` with a mobile-shaped
 * `connect(room)` in front of it: on web you construct a client and
 * connect it, whereas here the client already exists and joining a room
 * is the only step left. Everything else — `sendMessage`, `on`,
 * `messages.list`, presence, typing, reactions, read receipts, threads —
 * is the identical API, because it *is* the same object.
 */
export interface RavenChatHandle extends Omit<ChatClient, 'connect'> {
  /** Connects (if needed) and joins a conversation. Accepts a `conv_` id, a name, or an attached RTC room id. */
  connect(room: string): Promise<void>;
  /** Convenience for `sendMessage({ text })` — the common case on a phone. */
  send(text: string): Promise<unknown>;
}

export type { RavenAppState };
