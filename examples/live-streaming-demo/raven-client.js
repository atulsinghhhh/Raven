import { createRTCClient } from '@raven/rtc';
export { RTCError, isRTCError } from '@raven/rtc';
import { createChatClient } from '@raven/chat';
export { isRavenChatError } from '@raven/chat';

// src/index.ts
var LiveStream = class _LiveStream {
  constructor(streamId, role, rtc, room, chat, chatRootMessageId) {
    this.streamId = streamId;
    this.role = role;
    this.rtc = rtc;
    this.room = room;
    this.chat = chat;
    this.chatRootMessageId = chatRootMessageId;
  }
  /** True for HOST/CO_HOST — the only roles the server ever grants publish permissions to. A VIEWER's `room` is always subscribe-only, enforced server-side, not by this check. */
  get isHost() {
    return this.role === "HOST" || this.role === "CO_HOST";
  }
  /**
   * Joins a live stream. This is the one entry point for both a host and
   * a viewer — which one you get is entirely a function of the
   * credentials your backend minted, never a parameter here.
   */
  static async join(credentials) {
    const rtc = createRTCClient({
      token: credentials.rtc.token,
      endpoint: credentials.rtc.endpoint,
      iceServers: credentials.rtc.iceServers,
      telemetryUrl: credentials.rtc.telemetryUrl
    });
    const room = await rtc.join(credentials.streamId);
    let chat;
    if (credentials.chat) {
      chat = createChatClient({
        token: credentials.chat.token,
        apiUrl: credentials.chat.apiUrl,
        chatUrl: credentials.chat.chatUrl
      });
      await chat.connect({ room: credentials.chat.conversations[0] });
    }
    return new _LiveStream(credentials.streamId, credentials.role, rtc, room, chat, credentials.chatRootMessageId);
  }
  /**
   * The TikTok-style heart-tap. Reactions ride on the stream's own root
   * chat message through `@raven/chat`'s existing, already-aggregated
   * reaction model (`chat.messages.addReaction`) — not a second
   * real-time primitive invented for this. Every viewer's tap on the
   * same emoji collapses into one count, the same as reacting to any
   * chat message.
   */
  async react(emoji) {
    if (!this.chat) {
      throw new Error(
        "This LiveStream has no chat credentials \u2014 react() needs the `chat` field on the credentials passed to join()."
      );
    }
    if (!this.chatRootMessageId) {
      throw new Error("This stream has no chatRootMessageId to react to.");
    }
    await this.chat.messages.addReaction(this.chatRootMessageId, emoji);
  }
  /**
   * Leaves the room and disconnects chat. The stream itself keeps
   * running for everyone else — this only tears down *your* connection
   * to it. Ending the stream for everyone is a server-side action
   * (`POST /v1/live-streams/:id/end`), not something a client calls.
   */
  async leave() {
    await this.rtc.leave();
    await this.chat?.disconnect();
  }
};
function joinLiveStream(credentials) {
  return LiveStream.join(credentials);
}
var Raven = class {
  constructor(config) {
    this.live = { join: (credentials) => LiveStream.join(credentials) };
    if (Boolean(config.token) !== Boolean(config.endpoint)) {
      throw new Error(
        "Raven needs both `token` and `endpoint` for RTC, or neither for a messaging-only app. Both come from the same token-mint response."
      );
    }
    if (!config.token && !config.chatToken) {
      throw new Error(
        "Raven needs at least one credential: `token` + `endpoint` for calls, `chatToken` for messaging, or both."
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
        logLevel: config.logLevel
      });
    }
    if (config.chatToken) {
      this.chat = createChatClient({
        token: config.chatToken,
        apiUrl: config.chatApiUrl ?? config.telemetryUrl,
        chatUrl: config.chatUrl,
        logLevel: config.logLevel,
        onTokenExpiring: config.onChatTokenExpiring
      });
    }
  }
  /** True when this instance was given RTC credentials. */
  get hasRtc() {
    return this.rtc !== void 0;
  }
  /** True when this instance was given a chat token. */
  get hasChat() {
    return this.chat !== void 0;
  }
  /** The room currently joined, if any. */
  get room() {
    return this.currentRoom;
  }
  /**
   * Joins a room. Throws immediately, with an error that says why, if
   * this instance has no RTC credentials — rather than failing later as
   * a null reference.
   */
  async join(roomId) {
    if (!this.rtc) {
      throw new Error(
        "This Raven instance has no RTC credentials, so it cannot join a room. Pass `token` and `endpoint` to enable calls, or use `raven.chat` for messaging."
      );
    }
    this.currentRoom = await this.rtc.join(roomId);
    return this.currentRoom;
  }
  /** Leaves the room, keeping any chat connection open. */
  async leave() {
    await this.currentRoom?.leave();
    this.currentRoom = void 0;
  }
  /**
   * Tears down everything, including chat. Call this when the feature is
   * going away — `leave()` alone is right when moving between rooms.
   */
  async dispose() {
    await this.leave();
    await this.chat?.disconnect();
  }
};
function createRaven(config) {
  return new Raven(config);
}

export { LiveStream, Raven, createRaven, joinLiveStream };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map