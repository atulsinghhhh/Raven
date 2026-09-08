// src/errors.ts
var RavenChatError = class extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = "RavenChatError";
    this.code = code;
    this.cause = cause;
  }
};
var RavenChatConnectionError = class extends RavenChatError {
  constructor(message, code = "CONNECTION_FAILED", cause) {
    super(code, message, cause);
    this.name = "RavenChatConnectionError";
  }
};
var RavenChatAuthenticationError = class extends RavenChatError {
  constructor(message, code = "INVALID_TOKEN", cause) {
    super(code, message, cause);
    this.name = "RavenChatAuthenticationError";
  }
};
var RavenChatPermissionError = class extends RavenChatError {
  constructor(message, code = "PERMISSION_DENIED", cause) {
    super(code, message, cause);
    this.name = "RavenChatPermissionError";
  }
};
var RavenMessageError = class extends RavenChatError {
  constructor(message, code = "INVALID_MESSAGE", cause) {
    super(code, message, cause);
    this.name = "RavenMessageError";
  }
};
var RavenRateLimitError = class extends RavenChatError {
  constructor(message, retryAfterSeconds) {
    super("RATE_LIMITED", message);
    this.name = "RavenRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
};
var RavenRoomError = class extends RavenChatError {
  constructor(message, code = "ROOM_NOT_FOUND", cause) {
    super(code, message, cause);
    this.name = "RavenRoomError";
  }
};
var RavenAttachmentError = class extends RavenChatError {
  constructor(message, code = "ATTACHMENT_NOT_FOUND", cause) {
    super(code, message, cause);
    this.name = "RavenAttachmentError";
  }
};
function isRavenChatError(value) {
  return value instanceof RavenChatError;
}
function toRavenChatError(code, message, extra = {}) {
  const chatCode = code ?? "INTERNAL_ERROR";
  switch (chatCode) {
    case "INVALID_TOKEN":
    case "TOKEN_EXPIRED":
    case "TOKEN_REVOKED":
    case "UNAUTHORIZED":
      return new RavenChatAuthenticationError(message, chatCode);
    case "PERMISSION_DENIED":
    case "NOT_A_MEMBER":
    case "ORIGIN_NOT_ALLOWED":
      return new RavenChatPermissionError(message, chatCode);
    case "ROOM_NOT_FOUND":
    case "NOT_IN_ROOM":
    case "TOO_MANY_SUBSCRIPTIONS":
    case "CONVERSATION_ARCHIVED":
      return new RavenRoomError(message, chatCode);
    case "RATE_LIMITED":
      return new RavenRateLimitError(message, extra.retryAfterSeconds);
    case "ATTACHMENT_NOT_FOUND":
    case "ATTACHMENTS_NOT_CONFIGURED":
    case "ATTACHMENT_TOO_LARGE":
      return new RavenAttachmentError(message, chatCode);
    case "MESSAGE_NOT_FOUND":
    case "MESSAGE_DELETED":
    case "MESSAGE_TOO_LARGE":
    case "INVALID_MESSAGE":
    case "INVALID_MESSAGE_TYPE":
    case "INVALID_CURSOR":
      return new RavenMessageError(message, chatCode);
    case "CONNECTION_FAILED":
    case "CONNECTION_CLOSED":
    case "NETWORK_ERROR":
    case "TIMEOUT":
      return new RavenChatConnectionError(message, chatCode);
    default:
      return new RavenChatError(chatCode, message);
  }
}

// src/config.ts
function decodeChatToken(token) {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new RavenChatAuthenticationError("Chat token is malformed (expected a JWT with 3 parts)");
  }
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(base64));
    if (!payload.sub || !payload.pid || typeof payload.exp !== "number") {
      throw new Error("missing claims");
    }
    return payload;
  } catch (error) {
    throw new RavenChatAuthenticationError("Chat token payload could not be decoded", "INVALID_TOKEN", error);
  }
}
function validateConfig(config) {
  if (!config || typeof config !== "object") {
    throw new RavenChatAuthenticationError("createChatClient(config) requires a configuration object");
  }
  if (!config.token || typeof config.token !== "string") {
    throw new RavenChatAuthenticationError(
      "config.token is required; the chat token your backend minted via POST /v1/chat/tokens"
    );
  }
  const payload = decodeChatToken(config.token);
  if (payload.exp * 1e3 <= Date.now()) {
    throw new RavenChatAuthenticationError("Chat token has already expired", "TOKEN_EXPIRED");
  }
  const chatUrl = config.chatUrl ?? deriveChatUrl(config.apiUrl);
  if (!chatUrl) {
    throw new RavenChatAuthenticationError(
      'config.chatUrl is required; the "chatUrl" field from the same response as config.token'
    );
  }
  return {
    token: config.token,
    chatUrl,
    apiUrl: config.apiUrl ?? deriveApiUrl(chatUrl),
    logLevel: config.logLevel ?? "silent",
    autoReconnect: config.autoReconnect ?? true,
    maxReconnectAttempts: config.maxReconnectAttempts ?? 10,
    initialReconnectDelayMs: config.initialReconnectDelayMs ?? 500,
    maxReconnectDelayMs: config.maxReconnectDelayMs ?? 3e4,
    requestTimeoutMs: config.requestTimeoutMs ?? 15e3,
    onTokenExpiring: config.onTokenExpiring
  };
}
function deriveChatUrl(apiUrl) {
  if (!apiUrl) return void 0;
  const ws = apiUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:").replace(/\/$/, "");
  return `${ws}/v1/chat/ws`;
}
function deriveApiUrl(chatUrl) {
  return chatUrl.replace(/^ws:/, "http:").replace(/^wss:/, "https:").replace(/\/v1\/chat\/ws$/, "");
}

// src/events.ts
var TypedEventEmitter = class {
  constructor() {
    this.listeners = /* @__PURE__ */ new Map();
  }
  on(event, handler) {
    let set = this.listeners.get(event);
    if (!set) {
      set = /* @__PURE__ */ new Set();
      this.listeners.set(event, set);
    }
    set.add(handler);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.off(event, handler);
    };
  }
  off(event, handler) {
    const set = this.listeners.get(event);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) {
      this.listeners.delete(event);
    }
  }
  once(event, handler) {
    const wrapped = ((...args) => {
      unsubscribe();
      handler(...args);
    });
    const unsubscribe = this.on(event, wrapped);
    return unsubscribe;
  }
  removeAllListeners(event) {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }
  /** Test and diagnostic helper: how many handlers are on an event. */
  listenerCount(event) {
    return this.listeners.get(event)?.size ?? 0;
  }
  emit(event, ...args) {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const handler of Array.from(set)) {
      handler(...args);
    }
  }
};

// src/logger.ts
var LEVELS = ["silent", "error", "warn", "info", "debug"];
function createLogger(level = "silent") {
  const rank = LEVELS.indexOf(level);
  const enabled = (l) => LEVELS.indexOf(l) <= rank;
  return {
    error: (...args) => {
      if (enabled("error")) console.error("[raven-chat]", ...args);
    },
    warn: (...args) => {
      if (enabled("warn")) console.warn("[raven-chat]", ...args);
    },
    info: (...args) => {
      if (enabled("info")) console.info("[raven-chat]", ...args);
    },
    debug: (...args) => {
      if (enabled("debug")) console.debug("[raven-chat]", ...args);
    }
  };
}

// src/internal/rest-client.ts
var RestClient = class {
  constructor(baseUrl, token) {
    this.baseUrl = baseUrl;
    this.token = token;
  }
  setToken(token) {
    this.token = token;
  }
  async request(path, options = {}) {
    const url = new URL(`${this.baseUrl.replace(/\/$/, "")}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== void 0 && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
    let response;
    try {
      response = await fetch(url.toString(), {
        method: options.method ?? "GET",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.token}`
        },
        body: options.body !== void 0 ? JSON.stringify(options.body) : void 0
      });
    } catch (error) {
      throw new RavenChatConnectionError("Could not reach Raven", "NETWORK_ERROR", error);
    }
    if (response.status === 204) {
      return void 0;
    }
    const payload = await response.json().catch(() => void 0);
    if (!response.ok) {
      throw toRavenChatError(payload?.code, payload?.message ?? `Request failed with status ${response.status}`, {
        retryAfterSeconds: payload?.retryAfterSeconds
      });
    }
    return payload;
  }
};

// src/internal/backoff.ts
function backoffDelayMs(attempt, initialDelayMs, maxDelayMs, random = Math.random) {
  const exponential = Math.min(initialDelayMs * Math.pow(2, Math.max(0, attempt - 1)), maxDelayMs);
  const floor = exponential / 4;
  return Math.round(floor + random() * (exponential - floor));
}

// src/internal/socket-transport.ts
var TERMINAL_CLOSE_CODES = /* @__PURE__ */ new Set([
  4401,
  // auth failed
  4403
  // origin not allowed
]);
var TOKEN_EXPIRED_CLOSE_CODE = 4440;
var NORMAL_CLOSURE = 1e3;
var SocketTransport = class {
  constructor(options, handlers) {
    this.options = options;
    this.handlers = handlers;
    this.attempt = 0;
    /** Set when the caller asked to disconnect, so we don't "helpfully" reconnect anyway. */
    this.intentionallyClosed = false;
    this.token = options.token;
  }
  get isOpen() {
    return this.socket?.readyState === 1;
  }
  /** Swaps in a refreshed token. The next connect or reconnect uses it. */
  setToken(token) {
    this.token = token;
  }
  connect() {
    this.intentionallyClosed = false;
    this.open();
  }
  send(frame) {
    if (!this.socket || this.socket.readyState !== 1) {
      throw new RavenChatConnectionError("Not connected; call connect() first", "CONNECTION_CLOSED");
    }
    this.socket.send(JSON.stringify(frame));
  }
  disconnect(code = NORMAL_CLOSURE, reason = "client disconnect") {
    this.intentionallyClosed = true;
    this.clearReconnectTimer();
    this.attempt = 0;
    const socket = this.socket;
    this.socket = void 0;
    if (socket) {
      socket.onopen = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.onmessage = null;
      try {
        socket.close(code, reason);
      } catch {
      }
    }
  }
  open() {
    const factory = this.options.socketFactory ?? ((url2) => new WebSocket(url2));
    const url = `${this.options.url}?token=${encodeURIComponent(this.token)}&sdkVersion=${encodeURIComponent(
      this.options.sdkVersion
    )}&platform=browser`;
    let socket;
    try {
      socket = factory(url);
    } catch (error) {
      this.handlers.onError(
        new RavenChatConnectionError("Could not open a chat connection", "CONNECTION_FAILED", error)
      );
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      this.attempt = 0;
      this.handlers.onOpen();
    };
    socket.onmessage = (event) => {
      let frame;
      try {
        frame = JSON.parse(String(event.data));
      } catch {
        this.options.logger.warn("discarded a malformed frame from the server");
        return;
      }
      this.handlers.onFrame(frame);
    };
    socket.onerror = () => {
      this.options.logger.debug("chat socket error");
    };
    socket.onclose = (event) => {
      this.socket = void 0;
      if (this.intentionallyClosed) {
        this.handlers.onClose({
          code: event.code,
          reason: event.reason,
          willReconnect: false,
          terminal: false
        });
        return;
      }
      const terminal = TERMINAL_CLOSE_CODES.has(event.code);
      const attemptsExhausted = this.attempt >= this.options.maxReconnectAttempts;
      const willReconnect = this.options.autoReconnect && !terminal && !attemptsExhausted;
      this.handlers.onClose({
        code: event.code,
        reason: event.reason,
        willReconnect,
        terminal: terminal || this.options.autoReconnect && attemptsExhausted
      });
      if (terminal) {
        this.handlers.onError(
          toRavenChatError(event.reason || "UNAUTHORIZED", "The chat connection was rejected")
        );
        return;
      }
      if (willReconnect) {
        this.scheduleReconnect(event.code === TOKEN_EXPIRED_CLOSE_CODE);
        return;
      }
      if (this.options.autoReconnect && attemptsExhausted) {
        this.handlers.onError(
          new RavenChatConnectionError(
            `Could not reconnect after ${this.options.maxReconnectAttempts} attempts`,
            "CONNECTION_FAILED"
          )
        );
      }
    };
  }
  scheduleReconnect(tokenExpired = false) {
    if (this.intentionallyClosed || !this.options.autoReconnect) {
      return;
    }
    if (this.attempt >= this.options.maxReconnectAttempts) {
      this.handlers.onError(
        new RavenChatConnectionError(
          `Could not reconnect after ${this.options.maxReconnectAttempts} attempts`,
          "CONNECTION_FAILED"
        )
      );
      return;
    }
    this.attempt += 1;
    const delayMs = backoffDelayMs(
      this.attempt,
      this.options.initialReconnectDelayMs,
      this.options.maxReconnectDelayMs
    );
    this.options.logger.info(
      `reconnecting in ${delayMs}ms (attempt ${this.attempt}/${this.options.maxReconnectAttempts})`
    );
    this.handlers.onReconnecting(this.attempt, delayMs);
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.open();
    }, delayMs);
  }
  clearReconnectTimer() {
    if (this.reconnectTimer !== void 0) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = void 0;
    }
  }
};

// src/attachments-api.ts
var AttachmentsApi = class {
  constructor(rest, defaultRoom) {
    this.rest = rest;
    this.defaultRoom = defaultRoom;
  }
  /** Step 1 on its own, for callers driving the upload themselves: progress bars, resumable transfers. */
  createUploadTicket(input) {
    const room = input.room ?? this.defaultRoom();
    return this.rest.request(
      `/v1/chat/conversations/${encodeURIComponent(room)}/attachments`,
      {
        method: "POST",
        body: {
          filename: input.filename,
          mimeType: input.mimeType,
          size: input.size,
          metadata: input.metadata
        }
      }
    );
  }
  /**
   * Uploads a file and returns the attachment id to pass as
   * `sendMessage({ attachmentId })`.
   */
  async upload(file, options = {}) {
    const filename = options.filename ?? (file instanceof File ? file.name : "upload");
    const ticket = await this.createUploadTicket({
      filename,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      room: options.room,
      metadata: options.metadata
    });
    let response;
    try {
      response = await fetch(ticket.uploadUrl, {
        method: ticket.uploadMethod,
        headers: ticket.uploadHeaders,
        body: file
      });
    } catch (error) {
      throw new RavenAttachmentError("Could not reach object storage to upload the file", "NETWORK_ERROR", error);
    }
    if (!response.ok) {
      throw new RavenAttachmentError(
        `Object storage rejected the upload (status ${response.status})`,
        "ATTACHMENT_NOT_FOUND"
      );
    }
    await this.complete(ticket.id);
    return { ...ticket, status: "uploaded" };
  }
  /** Marks an upload finished, making the attachment sendable. */
  complete(attachmentId) {
    return this.rest.request(`/v1/chat/attachments/${encodeURIComponent(attachmentId)}/complete`, {
      method: "POST"
    });
  }
  /**
   * A short-lived signed download URL. Mint one when the user actually
   * clicks. Don't cache them: they expire, and that expiry is exactly what
   * stops a shared link turning into permanent access.
   */
  getDownloadUrl(attachmentId) {
    return this.rest.request(`/v1/chat/attachments/${encodeURIComponent(attachmentId)}/download-url`);
  }
};

// src/messages-api.ts
var MessagesApi = class {
  constructor(rest, defaultRoom, sendMessage) {
    this.rest = rest;
    this.defaultRoom = defaultRoom;
    this.sendMessage = sendMessage;
  }
  /**
   * Message history, newest first.
   *
   * Pagination is cursor-based and never offset-based. Pass the previous
   * page's `nextCursor` as `before` to walk back through history, or its
   * `previousCursor` as `after` to walk forward and catch up on whatever
   * arrived while you were away.
   *
   * ```ts
   * const page = await chat.messages.list({ room: "room_123", limit: 50 });
   * const older = await chat.messages.list({ before: page.nextCursor! });
   * ```
   */
  list(options = {}) {
    const room = options.room ?? this.defaultRoom();
    return this.rest.request(`/v1/chat/conversations/${encodeURIComponent(room)}/messages`, {
      query: {
        limit: options.limit,
        before: options.before,
        after: options.after,
        threadRootId: options.threadRootId,
        senderId: options.senderId,
        includeDeleted: options.includeDeleted
      }
    });
  }
  /** Also available as `chat.sendMessage(...)`; both are the same call. */
  send(options) {
    return this.sendMessage(options);
  }
  get(messageId) {
    return this.rest.request(`/v1/chat/messages/${encodeURIComponent(messageId)}`);
  }
  /**
   * Every message in this message's thread, oldest first: the root and its
   * replies. Threads live in the same store as everything else, so this is
   * a filtered read, not a separate system (spec §26).
   */
  thread(messageId) {
    return this.rest.request(`/v1/chat/messages/${encodeURIComponent(messageId)}/thread`);
  }
  /**
   * Edits a message. What comes back carries `edited: true` and an
   * `editedAt`. Raven never quietly rewrites history (spec §24).
   */
  update(messageId, changes) {
    return this.rest.request(`/v1/chat/messages/${encodeURIComponent(messageId)}`, {
      method: "PATCH",
      body: changes
    });
  }
  /**
   * Soft-deletes a message. It keeps its position and its id but loses its
   * body, so clients can render a placeholder instead of a hole opening up
   * in the middle of a conversation (spec §25).
   */
  delete(messageId) {
    return this.rest.request(`/v1/chat/messages/${encodeURIComponent(messageId)}`, {
      method: "DELETE"
    });
  }
  /** Adding the same reaction twice is a no-op, not a duplicate. */
  addReaction(messageId, emoji) {
    return this.rest.request(`/v1/chat/messages/${encodeURIComponent(messageId)}/reactions`, {
      method: "POST",
      body: { emoji }
    });
  }
  removeReaction(messageId, emoji) {
    return this.rest.request(
      `/v1/chat/messages/${encodeURIComponent(messageId)}/reactions/${encodeURIComponent(emoji)}`,
      { method: "DELETE" }
    );
  }
};

// src/version.ts
var CHAT_SDK_VERSION = "0.1.0";

// src/client.ts
var ChatClient = class extends TypedEventEmitter {
  /** @internal Use `createChatClient(config)`. The second parameter exists purely so tests can inject a fake socket. */
  constructor(config, socketFactory) {
    super();
    this.state = "idle";
    /** Rooms the caller asked to be in. Re-joined automatically after a reconnect. */
    this.desiredRooms = /* @__PURE__ */ new Set();
    this.pending = /* @__PURE__ */ new Map();
    this.requestCounter = 0;
    this.hasConnectedBefore = false;
    /** Local stop-typing timers, so a dropped `typing.stop` can't leave someone stuck typing. */
    this.typingTimers = /* @__PURE__ */ new Map();
    this.config = config;
    this.logger = createLogger(config.logLevel);
    this.rest = new RestClient(config.apiUrl, config.token);
    this.socketFactory = socketFactory;
    this.messages = new MessagesApi(this.rest, () => this.defaultRoom(), (options) => this.sendMessage(options));
    this.attachments = new AttachmentsApi(this.rest, () => this.defaultRoom());
    const payload = decodeChatToken(config.token);
    this.currentUserId = payload.sub;
    this.tokenExpiresAt = payload.exp * 1e3;
  }
  /** Who this client speaks as, read from the token. You can't set it from here. */
  get userId() {
    return this.currentUserId;
  }
  get connectionState() {
    return this.state;
  }
  /** Stable for the life of one socket, changes on reconnect. Worth quoting in a bug report. */
  get id() {
    return this.connectionId;
  }
  /** Rooms this client is currently joined to. */
  get rooms() {
    return Array.from(this.desiredRooms);
  }
  // -------------------------------------------------------------------------
  // Connection
  // -------------------------------------------------------------------------
  /**
   * Opens the connection and joins the rooms you asked for. Resolves once
   * the server has authenticated the socket, not merely when TCP came up,
   * so a resolved `connect()` really does mean you can send.
   */
  async connect(options = {}) {
    for (const room of [...options.room ? [options.room] : [], ...options.rooms ?? []]) {
      this.desiredRooms.add(room);
    }
    if (this.state === "connected") {
      await this.syncRooms();
      return;
    }
    this.setState("connecting");
    this.transport = new SocketTransport(
      {
        url: this.config.chatUrl,
        token: this.config.token,
        sdkVersion: CHAT_SDK_VERSION,
        autoReconnect: this.config.autoReconnect,
        maxReconnectAttempts: this.config.maxReconnectAttempts,
        initialReconnectDelayMs: this.config.initialReconnectDelayMs,
        maxReconnectDelayMs: this.config.maxReconnectDelayMs,
        logger: this.logger,
        socketFactory: this.socketFactory
      },
      {
        onOpen: () => this.logger.debug("socket open, waiting for server hello"),
        onFrame: (frame) => this.handleFrame(frame),
        onClose: (info) => this.handleClose(info),
        onReconnecting: (attempt) => {
          this.setState("reconnecting");
          this.emit("reconnecting", attempt);
        },
        onError: (error) => this.fail(error)
      }
    );
    const connected = new Promise((resolve, reject) => {
      this.connectPromise = { resolve, reject };
    });
    this.transport.connect();
    await connected;
    await this.syncRooms();
  }
  /** Closes the connection. No reconnect; call `connect()` again to come back. */
  async disconnect() {
    this.clearTokenRefreshTimer();
    for (const timer of this.typingTimers.values()) clearTimeout(timer);
    this.typingTimers.clear();
    for (const [, request] of this.pending) {
      clearTimeout(request.timer);
      request.reject(new RavenChatConnectionError("Connection closed before the server replied", "CONNECTION_CLOSED"));
    }
    this.pending.clear();
    this.transport?.disconnect();
    this.transport = void 0;
    this.connectionId = void 0;
    this.setState("disconnected");
  }
  /**
   * Force a reconnect right now. Rarely needed, since the SDK reconnects
   * on its own, but handy when the app knows the network changed (an
   * `online` event, say) and doesn't fancy waiting out the backoff.
   */
  async reconnect() {
    this.transport?.disconnect();
    this.transport = void 0;
    this.connectionId = void 0;
    await this.connect();
  }
  // -------------------------------------------------------------------------
  // Rooms
  // -------------------------------------------------------------------------
  async joinRoom(room) {
    this.desiredRooms.add(room);
    if (this.state === "connected") {
      await this.request("room.join", { room });
    }
  }
  async leaveRoom(room) {
    this.desiredRooms.delete(room);
    if (this.state === "connected") {
      await this.request("room.leave", { room });
    }
  }
  // -------------------------------------------------------------------------
  // Messaging
  // -------------------------------------------------------------------------
  /**
   * Sends a message and resolves with the stored one: canonical server id,
   * canonical timestamp. It only resolves after Raven has durably stored
   * it, so a resolved promise really does mean saved (spec §15).
   *
   * If you don't supply a `clientMessageId` we attach one, and that's what
   * makes retrying after a reconnect safe (spec §16).
   */
  async sendMessage(options) {
    const room = options.room ?? this.defaultRoom();
    if (this.state !== "connected") {
      return this.rest.request(
        `/v1/chat/conversations/${encodeURIComponent(room)}/messages`,
        { method: "POST", body: { ...options, room: void 0, clientMessageId: options.clientMessageId ?? generateClientMessageId() } }
      );
    }
    const ack = await this.request("message.send", {
      room,
      text: options.text,
      messageType: options.type,
      replyTo: options.replyTo,
      clientMessageId: options.clientMessageId ?? generateClientMessageId(),
      attachmentId: options.attachmentId,
      metadata: options.metadata,
      clientSentAt: Date.now()
    });
    return { ...ack.message, deduplicated: ack.deduplicated };
  }
  // -------------------------------------------------------------------------
  // Typing / presence / read
  // -------------------------------------------------------------------------
  /**
   * Signals that this user is typing. Call it on every keystroke; it's
   * fine. The server only broadcasts on the transition *into* typing, and
   * this arms a local timer to stop it automatically, so someone who
   * wanders off mid-sentence doesn't sit there "typing…" forever
   * (spec §21).
   */
  async startTyping(room) {
    const target = room ?? this.defaultRoom();
    this.send("typing.start", { room: target });
    const existing = this.typingTimers.get(target);
    if (existing) clearTimeout(existing);
    this.typingTimers.set(
      target,
      setTimeout(() => void this.stopTyping(target).catch(() => void 0), 5e3)
    );
  }
  async stopTyping(room) {
    const target = room ?? this.defaultRoom();
    const timer = this.typingTimers.get(target);
    if (timer) {
      clearTimeout(timer);
      this.typingTimers.delete(target);
    }
    this.send("typing.stop", { room: target });
  }
  /** Marks this message, and everything before it, as read. */
  async markAsRead(messageId) {
    if (this.state === "connected") {
      return this.request("read.mark", { messageId });
    }
    return this.rest.request(`/v1/chat/messages/${encodeURIComponent(messageId)}/read`, {
      method: "POST"
    });
  }
  /** Sets presence across every room this connection is holding. */
  async setPresence(status) {
    this.send("presence.set", { status });
  }
  /** Who is present in a room right now. */
  async getPresence(room) {
    const target = room ?? this.defaultRoom();
    return this.rest.request(`/v1/chat/conversations/${encodeURIComponent(target)}/presence`);
  }
  /** This user's read position and unread count for a room. */
  async getReadState(room) {
    const target = room ?? this.defaultRoom();
    return this.rest.request(`/v1/chat/conversations/${encodeURIComponent(target)}/read-state`);
  }
  /** Everyone's read position. This is what a "seen by" row is built from. */
  async getReadReceipts(room) {
    const target = room ?? this.defaultRoom();
    return this.rest.request(`/v1/chat/conversations/${encodeURIComponent(target)}/read-receipts`);
  }
  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------
  defaultRoom() {
    const first = this.desiredRooms.values().next();
    if (first.done) {
      throw new RavenRoomError(
        "No room selected; pass { room } to connect(), or a `room` option on this call",
        "NOT_IN_ROOM"
      );
    }
    return first.value;
  }
  setState(state) {
    if (this.state === state) return;
    this.state = state;
    this.emit("connectionStateChanged", state);
  }
  send(type, payload) {
    if (!this.transport?.isOpen) {
      this.logger.debug(`dropped ${type}; not connected`);
      return;
    }
    this.transport.send({ type, ...payload });
  }
  /** Sends a frame and waits for its correlated ack, with a timeout. */
  request(type, payload) {
    if (!this.transport?.isOpen) {
      return Promise.reject(
        new RavenChatConnectionError("Not connected; call connect() first", "CONNECTION_CLOSED")
      );
    }
    const id = `r${++this.requestCounter}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RavenChatConnectionError("The server did not respond in time", "TIMEOUT"));
      }, this.config.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.transport.send({ type, id, ...payload });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  handleFrame(frame) {
    const type = String(frame.type);
    switch (type) {
      case "connected":
        this.onServerHello(frame);
        return;
      case "ack": {
        const request = this.takePending(frame.id);
        request?.resolve(frame.data);
        return;
      }
      case "error": {
        const error = toRavenChatError(frame.code, String(frame.message ?? "Chat request failed"), {
          retryAfterSeconds: frame.retryAfterSeconds
        });
        const request = this.takePending(frame.id);
        if (request) {
          request.reject(error);
          return;
        }
        this.emit("error", error);
        return;
      }
      case "room.joined":
      case "room.left": {
        const request = this.takePending(frame.id);
        request?.resolve(frame);
        return;
      }
      case "message":
        this.emit("message", frame.message);
        return;
      case "message.updated":
        this.emit("messageUpdated", frame.message);
        return;
      case "message.deleted":
        this.emit("messageDeleted", {
          messageId: String(frame.messageId),
          roomId: String(frame.roomId),
          deletedAt: String(frame.deletedAt),
          deletedBy: frame.deletedBy ?? null
        });
        return;
      case "reaction.added":
      case "reaction.removed": {
        const event = {
          messageId: String(frame.messageId),
          roomId: String(frame.roomId),
          userId: String(frame.userId),
          emoji: String(frame.emoji),
          at: String(frame.at)
        };
        this.emit(type === "reaction.added" ? "reactionAdded" : "reactionRemoved", event);
        return;
      }
      case "typing.started":
      case "typing.stopped":
        this.emit("typing", {
          userId: String(frame.userId),
          roomId: String(frame.roomId),
          isTyping: type === "typing.started"
        });
        return;
      case "presence":
        this.emit("presence", {
          userId: String(frame.userId),
          roomId: String(frame.roomId),
          status: frame.status,
          at: String(frame.at)
        });
        return;
      case "read":
        this.emit("read", {
          userId: String(frame.userId),
          roomId: String(frame.roomId),
          messageId: frame.messageId ?? null,
          at: String(frame.at)
        });
        return;
      case "pong":
        return;
      default:
        this.logger.debug(`ignoring unknown frame "${type}"`);
    }
  }
  onServerHello(frame) {
    this.connectionId = frame.connectionId;
    const wasReconnecting = this.hasConnectedBefore;
    this.hasConnectedBefore = true;
    this.setState("connected");
    this.scheduleTokenRefresh(frame.expiresAt);
    this.connectPromise?.resolve();
    this.connectPromise = void 0;
    if (wasReconnecting) {
      void this.syncRooms().then(() => this.emit("reconnected"));
    } else {
      this.emit("connected");
    }
  }
  handleClose(info) {
    this.connectionId = void 0;
    for (const [, request] of this.pending) {
      clearTimeout(request.timer);
      request.reject(
        new RavenChatConnectionError("Connection closed before the server replied", "CONNECTION_CLOSED")
      );
    }
    this.pending.clear();
    if (info.willReconnect) {
      this.setState("reconnecting");
      return;
    }
    this.setState(info.terminal ? "failed" : "disconnected");
    this.emit("disconnected");
    this.connectPromise?.reject(
      new RavenChatConnectionError(`Chat connection closed (${info.code})`, "CONNECTION_CLOSED")
    );
    this.connectPromise = void 0;
  }
  fail(error) {
    this.setState("failed");
    this.connectPromise?.reject(error);
    this.connectPromise = void 0;
    this.emit("error", error);
  }
  async syncRooms() {
    for (const room of this.desiredRooms) {
      try {
        await this.request("room.join", { room });
      } catch (error) {
        this.emit("error", error instanceof RavenChatError ? error : toRavenChatError(void 0, String(error)));
      }
    }
  }
  /**
   * Refreshes the token shortly before it expires, assuming the app gave us
   * a way to fetch a new one. Without `onTokenExpiring` the socket just
   * closes at expiry. Correct, but abrupt, which is why this exists.
   */
  scheduleTokenRefresh(expiresAt) {
    this.clearTokenRefreshTimer();
    if (!this.config.onTokenExpiring) return;
    const expiry = expiresAt ? Date.parse(expiresAt) : this.tokenExpiresAt;
    const refreshAt = Math.max(expiry - 6e4, Date.now() + 5e3);
    this.tokenRefreshTimer = setTimeout(() => {
      void (async () => {
        try {
          const token = await this.config.onTokenExpiring();
          const payload = decodeChatToken(token);
          this.currentUserId = payload.sub;
          this.tokenExpiresAt = payload.exp * 1e3;
          this.rest.setToken(token);
          this.transport?.setToken(token);
          await this.reconnect();
        } catch (error) {
          this.emit(
            "error",
            error instanceof RavenChatError ? error : toRavenChatError("TOKEN_EXPIRED", "Could not refresh the chat token")
          );
        }
      })();
    }, refreshAt - Date.now());
  }
  clearTokenRefreshTimer() {
    if (this.tokenRefreshTimer !== void 0) {
      clearTimeout(this.tokenRefreshTimer);
      this.tokenRefreshTimer = void 0;
    }
  }
  takePending(id) {
    if (typeof id !== "string") return void 0;
    const request = this.pending.get(id);
    if (!request) return void 0;
    clearTimeout(request.timer);
    this.pending.delete(id);
    return request;
  }
};
function createChatClient(config) {
  return new ChatClient(validateConfig(config));
}
function generateClientMessageId() {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `cm_${random}`;
}

export { AttachmentsApi, CHAT_SDK_VERSION, ChatClient, MessagesApi, RavenAttachmentError, RavenChatAuthenticationError, RavenChatConnectionError, RavenChatError, RavenChatPermissionError, RavenMessageError, RavenRateLimitError, RavenRoomError, createChatClient, isRavenChatError };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map