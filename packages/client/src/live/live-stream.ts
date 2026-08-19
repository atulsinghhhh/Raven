import { createChatClient, type ChatClient } from '@corvidhq/chat';
import { createRTCClient, type Room, type RTCClient } from '@corvidhq/rtc';
import type { LiveStreamCredentials, LiveStreamRole } from './types';

/**
 * Raven Live Streaming, for the browser.
 *
 * Not a third real-time system: `LiveStream.join()` takes the credentials
 * your backend minted (`POST /v1/live-streams/:id/hosts` or
 * `.../viewer-tokens`) and produces a real `@corvidhq/rtc` `Room` plus, when
 * the credentials include one, a real `@corvidhq/chat` `ChatClient` — the
 * exact same classes those packages already document, not wrappers
 * around them. `LiveStream.room` **is** an `@corvidhq/rtc` `Room`; every
 * method and event on it works exactly as documented there.
 *
 * A live stream's "host publishes, viewers subscribe" behavior is
 * ordinary `room.enableCamera()`/`enableMicrophone()` on one side and
 * nothing on the other — the server already decided who gets which via
 * the RTC token's permission grant before either browser ever saw a
 * byte. This class never asks you for a role and never sends one; `role`
 * is informational, read from what your backend told it.
 *
 * ```ts
 * // Your own backend calls POST /v1/live-streams/:id/hosts (or
 * // .../viewer-tokens) and sends the response to this device.
 * const stream = await LiveStream.join(credentials);
 *
 * if (stream.isHost) {
 *   await stream.room.enableCamera();
 *   await stream.room.enableMicrophone();
 * }
 *
 * stream.room.on('trackSubscribed', (track) => videoEl.srcObject = track.mediaStream);
 * await stream.react('❤️');
 * await stream.leave();
 * ```
 */
export class LiveStream {
  readonly streamId: string;
  readonly role: LiveStreamRole;
  /** The underlying `@corvidhq/rtc` client — use this directly for anything not exposed on `LiveStream` itself. */
  readonly rtc: RTCClient;
  /** The joined room. Camera, microphone, screen share, participants, connection stats — everything `@corvidhq/rtc`'s Room documents. */
  readonly room: Room;
  /** Present only when the credentials included a chat token. `undefined` for an RTC-only integration. */
  readonly chat?: ChatClient;

  private readonly chatRootMessageId?: string | null;

  private constructor(
    streamId: string,
    role: LiveStreamRole,
    rtc: RTCClient,
    room: Room,
    chat: ChatClient | undefined,
    chatRootMessageId: string | null | undefined,
  ) {
    this.streamId = streamId;
    this.role = role;
    this.rtc = rtc;
    this.room = room;
    this.chat = chat;
    this.chatRootMessageId = chatRootMessageId;
  }

  /** True for HOST/CO_HOST — the only roles the server ever grants publish permissions to. A VIEWER's `room` is always subscribe-only, enforced server-side, not by this check. */
  get isHost(): boolean {
    return this.role === 'HOST' || this.role === 'CO_HOST';
  }

  /**
   * Joins a live stream. This is the one entry point for both a host and
   * a viewer — which one you get is entirely a function of the
   * credentials your backend minted, never a parameter here.
   */
  static async join(credentials: LiveStreamCredentials): Promise<LiveStream> {
    const rtc = createRTCClient({
      token: credentials.rtc.token,
      endpoint: credentials.rtc.endpoint,
      iceServers: credentials.rtc.iceServers,
      telemetryUrl: credentials.rtc.telemetryUrl,
    });
    const room = await rtc.join(credentials.streamId);

    let chat: ChatClient | undefined;
    if (credentials.chat) {
      chat = createChatClient({
        token: credentials.chat.token,
        apiUrl: credentials.chat.apiUrl,
        chatUrl: credentials.chat.chatUrl,
      });
      await chat.connect({ room: credentials.chat.conversations[0] });
    }

    return new LiveStream(credentials.streamId, credentials.role, rtc, room, chat, credentials.chatRootMessageId);
  }

  /**
   * The TikTok-style heart-tap. Reactions ride on the stream's own root
   * chat message through `@corvidhq/chat`'s existing, already-aggregated
   * reaction model (`chat.messages.addReaction`) — not a second
   * real-time primitive invented for this. Every viewer's tap on the
   * same emoji collapses into one count, the same as reacting to any
   * chat message.
   */
  async react(emoji: string): Promise<void> {
    if (!this.chat) {
      throw new Error(
        'This LiveStream has no chat credentials — react() needs the `chat` field on the credentials passed to join().',
      );
    }
    if (!this.chatRootMessageId) {
      throw new Error('This stream has no chatRootMessageId to react to.');
    }
    await this.chat.messages.addReaction(this.chatRootMessageId, emoji);
  }

  /**
   * Leaves the room and disconnects chat. The stream itself keeps
   * running for everyone else — this only tears down *your* connection
   * to it. Ending the stream for everyone is a server-side action
   * (`POST /v1/live-streams/:id/end`), not something a client calls.
   */
  async leave(): Promise<void> {
    await this.rtc.leave();
    await this.chat?.disconnect();
  }
}

/** Functional alias, matching `createRTCClient`/`createChatClient`/`createRaven`. */
export function joinLiveStream(credentials: LiveStreamCredentials): Promise<LiveStream> {
  return LiveStream.join(credentials);
}
