import { createChatClient, type ChatClient } from '@ravenkash/chat';
import { createRTCClient, type Room, type RTCClient } from '@ravenkash/rtc';
import type { LiveStreamCredentials, LiveStreamRole } from './types';

/**
 * Raven Live Streaming, for the browser.
 *
 * Not a third real-time system. `LiveStream.join()` takes the credentials
 * your backend minted (`POST /v1/live-streams/:id/hosts` or
 * `.../viewer-tokens`) and gives you a real `@ravenkash/rtc` `Room`, plus a
 * real `@ravenkash/chat` `ChatClient` when the credentials include one.
 * The very same classes those packages already document, not wrappers
 * round them. `LiveStream.room` **is** an `@ravenkash/rtc` `Room`, and
 * every method and event on it behaves exactly as documented there.
 *
 * The "host publishes, viewers subscribe" behaviour of a live stream is
 * just ordinary `room.enableCamera()`/`enableMicrophone()` on one side and
 * nothing at all on the other. The server settled who gets which via the
 * RTC token's permission grant long before either browser saw a byte. This
 * class never asks you for a role and never sends one; `role` is purely
 * informational, read back from what your backend told it.
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
  /** The underlying `@ravenkash/rtc` client. Go straight to it for anything `LiveStream` doesn't expose. */
  readonly rtc: RTCClient;
  /** The joined room: camera, microphone, screen share, participants, connection stats. Everything `@ravenkash/rtc`'s Room documents. */
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

  /** True for HOST and CO_HOST, the only roles the server grants publish permissions to. A VIEWER's `room` is always subscribe-only, and the server enforces that; this check doesn't. */
  get isHost(): boolean {
    return this.role === 'HOST' || this.role === 'CO_HOST';
  }

  /**
   * Joins a live stream. One entry point for hosts and viewers alike.
   * Which one you end up as follows entirely from the credentials your
   * backend minted; it's never a parameter here.
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
   * The TikTok-style heart tap. Reactions ride on the stream's own root
   * chat message through `@ravenkash/chat`'s existing, already-aggregated
   * reaction model (`chat.messages.addReaction`). No second real-time
   * primitive invented specially for this. Every viewer tapping the same
   * emoji collapses into one count, exactly like reacting to any other
   * chat message.
   */
  async react(emoji: string): Promise<void> {
    if (!this.chat) {
      throw new Error(
        'This LiveStream has no chat credentials; react() needs the `chat` field on the credentials passed to join().',
      );
    }
    if (!this.chatRootMessageId) {
      throw new Error('This stream has no chatRootMessageId to react to.');
    }
    await this.chat.messages.addReaction(this.chatRootMessageId, emoji);
  }

  /**
   * Leaves the room and disconnects chat. The stream carries on for
   * everybody else; this only tears down *your* connection to it. Ending
   * it for everyone is a server-side action
   * (`POST /v1/live-streams/:id/end`), not something a client gets to do.
   */
  async leave(): Promise<void> {
    await this.rtc.leave();
    await this.chat?.disconnect();
  }
}

/** Functional alias, to match `createRTCClient`, `createChatClient` and `createRaven`. */
export function joinLiveStream(credentials: LiveStreamCredentials): Promise<LiveStream> {
  return LiveStream.join(credentials);
}
