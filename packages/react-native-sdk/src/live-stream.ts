import { RTCError, type LogLevel, type Room } from '@corvidhq/rtc';
import { Raven } from './raven';
import type { RavenAppState } from './internal/lifecycle';
import type { RavenChatHandle, LiveStreamCredentials, LiveStreamRole } from './types';

export interface RavenLiveStreamOptions {
  logLevel?: LogLevel;
  /** Defaults to true. */
  autoReconnect?: boolean;
  /** Set false if your app already owns the audio session. */
  manageAudioSession?: boolean;
  onAppStateChange?: (state: RavenAppState) => void;
  onNetworkReconnect?: () => void;
  onChatTokenExpiring?: () => Promise<string> | string;
}

/**
 * Raven Live Streaming on React Native (Phase 14).
 *
 * Deliberately a thin wrapper around `Raven`, not a parallel
 * implementation: a stream's host and viewers are ordinary RTC
 * participants of one room, and its chat is an ordinary `@corvidhq/chat`
 * conversation — exactly what `Raven` already joins and connects to. That
 * means every mobile-only concern `Raven.join()` already handles
 * (permissions, audio session, app lifecycle, network recovery) applies
 * to a live stream unchanged, instead of being re-solved here.
 *
 * ```ts
 * const stream = await joinLiveStream(credentials);
 * await stream.room?.enableCamera(); // only meaningful for a host/co-host
 * await stream.react('❤️');
 * await stream.leave();
 * ```
 */
export class RavenLiveStream {
  readonly streamId: string;
  readonly role: LiveStreamRole;
  private readonly raven: Raven;
  private readonly chatRootMessageId?: string | null;

  constructor(credentials: LiveStreamCredentials, options: RavenLiveStreamOptions = {}) {
    this.streamId = credentials.streamId;
    this.role = credentials.role;
    this.chatRootMessageId = credentials.chatRootMessageId;

    this.raven = new Raven({
      token: credentials.rtc.token,
      endpoint: credentials.rtc.endpoint,
      iceServers: credentials.rtc.iceServers,
      telemetryUrl: credentials.rtc.telemetryUrl,
      chatToken: credentials.chat?.token,
      chatApiUrl: credentials.chat?.apiUrl,
      chatUrl: credentials.chat?.chatUrl,
      logLevel: options.logLevel,
      autoReconnect: options.autoReconnect,
      manageAudioSession: options.manageAudioSession,
      onAppStateChange: options.onAppStateChange,
      onNetworkReconnect: options.onNetworkReconnect,
      onChatTokenExpiring: options.onChatTokenExpiring,
    });
  }

  /** `true` for HOST and CO_HOST — never inferred, only ever what the credentials said. */
  get isHost(): boolean {
    return this.role === 'HOST' || this.role === 'CO_HOST';
  }

  /** The room, once joined. */
  get room(): Room | undefined {
    return this.raven.room;
  }

  /** Present only when the stream has a chat conversation attached. */
  get chat(): RavenChatHandle | undefined {
    return this.raven.chat;
  }

  get appState(): RavenAppState {
    return this.raven.appState;
  }

  /**
   * Joins the stream's room and connects its chat (if attached).
   *
   * Defaults `requestPermissions` to whether this credential can publish
   * at all — prompting a VIEWER for camera access would draw a dialog for
   * a permission their token can never use.
   */
  async join(options: { requestPermissions?: boolean } = {}): Promise<Room> {
    return this.raven.join(this.streamId, {
      requestPermissions: options.requestPermissions ?? this.isHost,
    });
  }

  /**
   * Reacts to the stream — the same reaction model as web/CLI/server,
   * attached to the chat message every viewer's reaction lands on.
   * Throws if this stream has no chat conversation attached.
   */
  async react(emoji: string): Promise<void> {
    if (!this.chat || !this.chatRootMessageId) {
      throw new RTCError(
        'INVALID_TOKEN',
        'This stream has no chat conversation attached, so reactions are unavailable.',
      );
    }
    await this.chat.messages.addReaction(this.chatRootMessageId, emoji);
  }

  /** Leaves the room and closes the chat connection. Safe to call more than once. */
  async leave(): Promise<void> {
    await this.raven.dispose();
  }
}

/** `RavenLiveStream.join()` in one call — the common case. */
export async function joinLiveStream(
  credentials: LiveStreamCredentials,
  options: RavenLiveStreamOptions = {},
): Promise<RavenLiveStream> {
  const stream = new RavenLiveStream(credentials, options);
  await stream.join();
  return stream;
}
