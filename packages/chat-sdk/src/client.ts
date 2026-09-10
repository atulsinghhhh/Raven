import { decodeChatToken, validateConfig, type ChatClientConfig, type ResolvedChatClientConfig } from './config';
import {
  RavenChatConnectionError,
  RavenChatError,
  RavenMessageError,
  RavenRoomError,
  toRavenChatError,
} from './errors';
import { TypedEventEmitter, type Unsubscribe } from './events';
import { createLogger, type Logger } from './logger';
import { RestClient } from './internal/rest-client';
import { SocketTransport, type WebSocketFactory } from './internal/socket-transport';
import { RecoveryTracker, type RoomRecoveryResult } from './internal/recovery';
import { AttachmentsApi } from './attachments-api';
import { MessagesApi } from './messages-api';
import type {
  ChatConnectionState,
  ChatMessage,
  MessageDeletedEvent,
  PresenceEvent,
  PresenceStatus,
  ReactionEvent,
  ReadReceiptEvent,
  ReadState,
  SendMessageOptions,
  SendMessageResult,
  TypingEvent,
} from './types';
import { CHAT_SDK_VERSION } from './version';

export interface ChatEventMap {
  /** A message arrived, your own included, echoed back with its canonical id. */
  message: (message: ChatMessage) => void;
  messageUpdated: (message: ChatMessage) => void;
  messageDeleted: (event: MessageDeletedEvent) => void;
  reactionAdded: (event: ReactionEvent) => void;
  reactionRemoved: (event: ReactionEvent) => void;
  typing: (event: TypingEvent) => void;
  presence: (event: PresenceEvent) => void;
  read: (event: ReadReceiptEvent) => void;
  connectionStateChanged: (state: ChatConnectionState) => void;
  connected: () => void;
  disconnected: () => void;
  reconnecting: (attempt: number) => void;
  reconnected: () => void;
  /**
   * Catch-up after a reconnect has finished.
   *
   * Anything it recovered has already been delivered through `message`, so
   * an app that just renders messages needs nothing here. It is worth
   * listening to for two things: `gap` says some messages could not be
   * recovered and the view should be reloaded, and `errors` says a room's
   * catch-up did not complete and will be retried on the next reconnect.
   */
  recovered: (summary: RecoverySummary) => void;
  error: (error: RavenChatError) => void;
}

export interface RecoverySummary {
  /** How many missed messages were delivered, across every room. */
  recovered: number;
  perRoom: RoomRecoveryResult[];
  /** True when at least one room had to restart from the newest page, skipping older messages. */
  gap: boolean;
  /** Rooms whose catch-up did not complete. They are retried on the next reconnect. */
  errors: RoomRecoveryResult[];
}

export interface ConnectOptions {
  /** Conversation to join: a `conv_...` id, its name, or an attached RTC room id. */
  room?: string;
  /** Join several at once. Merged with `room`. */
  rooms?: string[];
}

interface PendingRequest {
  resolve: (data: unknown) => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * The Livqeno Chat client.
 *
 * Nobody using this constructs a `WebSocket`, reconnects by hand, sees a
 * frame type, or ever finds out which gateway instance is holding their
 * socket (spec §2, §12). What you see here is the whole API: connect,
 * send, listen, plus the `messages` namespace for history and per-message
 * operations.
 */
export class ChatClient extends TypedEventEmitter<ChatEventMap> {
  /** History, editing, reactions, threads. Grouped to keep the top level small. */
  readonly messages: MessagesApi;
  /** Signed uploads and downloads. Bytes never go near the WebSocket. */
  readonly attachments: AttachmentsApi;

  private readonly config: ResolvedChatClientConfig;
  private readonly logger: Logger;
  private readonly rest: RestClient;
  private transport?: SocketTransport;
  private readonly socketFactory?: WebSocketFactory;

  private state: ChatConnectionState = 'idle';
  private connectionId?: string;
  private currentUserId: string;
  private tokenExpiresAt: number;
  private tokenRefreshTimer?: ReturnType<typeof setTimeout>;

  /** Rooms the caller asked to be in. Re-joined automatically after a reconnect. */
  private readonly desiredRooms = new Set<string>();
  private readonly pending = new Map<string, PendingRequest>();
  private requestCounter = 0;
  /** Resolves on the first `connected` frame, so `await connect()` genuinely means connected. */
  private connectPromise?: { resolve: () => void; reject: (error: unknown) => void };
  private hasConnectedBefore = false;
  /** Local stop-typing timers, so a dropped `typing.stop` can't leave someone stuck typing. */
  private readonly typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Per-room resume points and de-duplication. See internal/recovery.ts. */
  private readonly recovery: RecoveryTracker;
  /**
   * Live messages that arrived while a catch-up was still running, held
   * back so they cannot overtake the older messages being replayed.
   */
  private readonly pendingLive = new Map<string, ChatMessage[]>();
  private recovering = false;

  /** @internal Use `createChatClient(config)`. The second parameter exists purely so tests can inject a fake socket. */
  constructor(config: ResolvedChatClientConfig, socketFactory?: WebSocketFactory) {
    super();
    this.config = config;
    this.logger = createLogger(config.logLevel);
    this.rest = new RestClient(config.apiUrl, config.token);
    this.socketFactory = socketFactory;
    this.messages = new MessagesApi(
      this.rest,
      () => this.defaultRoom(),
      (options) => this.sendMessage(options),
      (page) => this.recovery.observeHistory(page.data),
    );
    this.attachments = new AttachmentsApi(this.rest, () => this.defaultRoom());

    const payload = decodeChatToken(config.token);
    this.currentUserId = payload.sub;
    this.tokenExpiresAt = payload.exp * 1000;

    this.recovery = new RecoveryTracker({
      // Deliberately the same public, authorized history call an
      // application would make. Recovery has no privileged path into the
      // store, so a room the token cannot read cannot be recovered either.
      listMessages: (options) => this.messages.listRaw(options),
      deliver: (message) => this.emit('message', message),
      logger: this.logger,
      isConnected: () => this.state === 'connected',
      maxAttempts: 3,
      retryDelayMs: (attempt) => Math.min(500 * 2 ** (attempt - 1), 5_000),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    });
  }

  /** Who this client speaks as, read from the token. You can't set it from here. */
  get userId(): string {
    return this.currentUserId;
  }

  get connectionState(): ChatConnectionState {
    return this.state;
  }

  /** Stable for the life of one socket, changes on reconnect. Worth quoting in a bug report. */
  get id(): string | undefined {
    return this.connectionId;
  }

  /** Rooms this client is currently joined to. */
  get rooms(): string[] {
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
  async connect(options: ConnectOptions = {}): Promise<void> {
    for (const room of [...(options.room ? [options.room] : []), ...(options.rooms ?? [])]) {
      this.desiredRooms.add(room);
    }

    if (this.state === 'connected') {
      // Already up. Just make sure the newly-requested rooms get joined.
      await this.syncRooms();
      return;
    }

    this.setState('connecting');
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
        socketFactory: this.socketFactory,
      },
      {
        onOpen: () => this.logger.debug('socket open, waiting for server hello'),
        onFrame: (frame) => this.handleFrame(frame),
        onClose: (info) => this.handleClose(info),
        onReconnecting: (attempt) => {
          this.setState('reconnecting');
          this.emit('reconnecting', attempt);
        },
        onError: (error) => this.fail(error),
      },
    );

    const connected = new Promise<void>((resolve, reject) => {
      this.connectPromise = { resolve, reject };
    });

    this.transport.connect();
    await connected;
    await this.syncRooms();
  }

  /** Closes the connection. No reconnect; call `connect()` again to come back. */
  async disconnect(): Promise<void> {
    this.clearTokenRefreshTimer();
    for (const timer of this.typingTimers.values()) clearTimeout(timer);
    this.typingTimers.clear();

    // Reject anything still waiting, rather than leave callers hanging on
    // a promise that can never resolve now.
    for (const [, request] of this.pending) {
      clearTimeout(request.timer);
      request.reject(new RavenChatConnectionError('Connection closed before the server replied', 'CONNECTION_CLOSED'));
    }
    this.pending.clear();

    this.transport?.disconnect();
    this.transport = undefined;
    this.connectionId = undefined;
    // Buffered live messages belong to a catch-up that will never finish
    // now. The resume points stay: an explicit disconnect followed by
    // connect() should still recover what was missed in between.
    this.pendingLive.clear();
    this.recovering = false;
    this.setState('disconnected');
  }

  /**
   * Force a reconnect right now. Rarely needed, since the SDK reconnects
   * on its own, but handy when the app knows the network changed (an
   * `online` event, say) and doesn't fancy waiting out the backoff.
   */
  async reconnect(): Promise<void> {
    this.transport?.disconnect();
    this.transport = undefined;
    this.connectionId = undefined;
    await this.connect();
  }

  // -------------------------------------------------------------------------
  // Rooms
  // -------------------------------------------------------------------------

  async joinRoom(room: string): Promise<void> {
    this.desiredRooms.add(room);
    if (this.state === 'connected') {
      await this.request('room.join', { room });
    }
  }

  async leaveRoom(room: string): Promise<void> {
    this.desiredRooms.delete(room);
    // Deliberately leaving on purpose is not an outage: drop the resume
    // point so re-joining later starts fresh rather than replaying
    // everything said while the caller was deliberately not listening.
    this.recovery.forget(room);
    this.pendingLive.delete(room);
    if (this.state === 'connected') {
      await this.request('room.leave', { room });
    }
  }

  // -------------------------------------------------------------------------
  // Messaging
  // -------------------------------------------------------------------------

  /**
   * Sends a message and resolves with the stored one: canonical server id,
   * canonical timestamp. It only resolves after Livqeno has durably stored
   * it, so a resolved promise really does mean saved (spec §15).
   *
   * If you don't supply a `clientMessageId` we attach one, and that's what
   * makes retrying after a reconnect safe (spec §16).
   */
  async sendMessage(options: SendMessageOptions): Promise<SendMessageResult> {
    const room = options.room ?? this.defaultRoom();

    // Falls back to HTTP when the socket is down. The message still gets
    // stored and fanned out to everyone else. Losing a connection should
    // not quietly lose whatever the user just typed.
    if (this.state !== 'connected') {
      return this.rest.request<SendMessageResult>(`/v1/chat/conversations/${encodeURIComponent(room)}/messages`, {
        method: 'POST',
        body: { ...options, room: undefined, clientMessageId: options.clientMessageId ?? generateClientMessageId() },
      });
    }

    const ack = await this.request<{ message: SendMessageResult; deduplicated: boolean }>('message.send', {
      room,
      text: options.text,
      messageType: options.type,
      replyTo: options.replyTo,
      clientMessageId: options.clientMessageId ?? generateClientMessageId(),
      attachmentId: options.attachmentId,
      metadata: options.metadata,
      clientSentAt: Date.now(),
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
  async startTyping(room?: string): Promise<void> {
    const target = room ?? this.defaultRoom();
    this.send('typing.start', { room: target });

    const existing = this.typingTimers.get(target);
    if (existing) clearTimeout(existing);
    this.typingTimers.set(
      target,
      setTimeout(() => void this.stopTyping(target).catch(() => undefined), 5_000),
    );
  }

  async stopTyping(room?: string): Promise<void> {
    const target = room ?? this.defaultRoom();
    const timer = this.typingTimers.get(target);
    if (timer) {
      clearTimeout(timer);
      this.typingTimers.delete(target);
    }
    this.send('typing.stop', { room: target });
  }

  /** Marks this message, and everything before it, as read. */
  async markAsRead(messageId: string): Promise<ReadState> {
    if (this.state === 'connected') {
      return this.request<ReadState>('read.mark', { messageId });
    }
    return this.rest.request<ReadState>(`/v1/chat/messages/${encodeURIComponent(messageId)}/read`, {
      method: 'POST',
    });
  }

  /** Sets presence across every room this connection is holding. */
  async setPresence(status: PresenceStatus): Promise<void> {
    this.send('presence.set', { status });
  }

  /** Who is present in a room right now. */
  async getPresence(room?: string): Promise<Array<{ userId: string; status: PresenceStatus }>> {
    const target = room ?? this.defaultRoom();
    return this.rest.request(`/v1/chat/conversations/${encodeURIComponent(target)}/presence`);
  }

  /** This user's read position and unread count for a room. */
  async getReadState(room?: string): Promise<ReadState> {
    const target = room ?? this.defaultRoom();
    return this.rest.request(`/v1/chat/conversations/${encodeURIComponent(target)}/read-state`);
  }

  /** Everyone's read position. This is what a "seen by" row is built from. */
  async getReadReceipts(room?: string): Promise<ReadState[]> {
    const target = room ?? this.defaultRoom();
    return this.rest.request(`/v1/chat/conversations/${encodeURIComponent(target)}/read-receipts`);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private defaultRoom(): string {
    const first = this.desiredRooms.values().next();
    if (first.done) {
      throw new RavenRoomError(
        'No room selected; pass { room } to connect(), or a `room` option on this call',
        'NOT_IN_ROOM',
      );
    }
    return first.value;
  }

  private setState(state: ChatConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    this.emit('connectionStateChanged', state);
  }

  private send(type: string, payload: Record<string, unknown>): void {
    if (!this.transport?.isOpen) {
      // Typing and presence are ephemeral by nature. Queue them up to
      // replay after a reconnect and you deliver stale signals, so they get
      // dropped on purpose instead of buffered.
      this.logger.debug(`dropped ${type}; not connected`);
      return;
    }
    this.transport.send({ type, ...payload });
  }

  /** Sends a frame and waits for its correlated ack, with a timeout. */
  private request<T = unknown>(type: string, payload: Record<string, unknown>): Promise<T> {
    if (!this.transport?.isOpen) {
      return Promise.reject(new RavenChatConnectionError('Not connected; call connect() first', 'CONNECTION_CLOSED'));
    }

    const id = `r${++this.requestCounter}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RavenChatConnectionError('The server did not respond in time', 'TIMEOUT'));
      }, this.config.requestTimeoutMs);

      this.pending.set(id, { resolve: resolve as (data: unknown) => void, reject, timer });
      try {
        this.transport!.send({ type, id, ...payload });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  private handleFrame(frame: Record<string, unknown>): void {
    const type = String(frame.type);

    switch (type) {
      case 'connected':
        this.onServerHello(frame);
        return;

      case 'ack': {
        const request = this.takePending(frame.id);
        request?.resolve(frame.data);
        return;
      }

      case 'error': {
        const error = toRavenChatError(frame.code as string, String(frame.message ?? 'Chat request failed'), {
          retryAfterSeconds: frame.retryAfterSeconds as number | undefined,
        });
        const request = this.takePending(frame.id);
        if (request) {
          // This correlates to a call the developer made, so reject their
          // promise instead of firing a global error they can't trace back.
          request.reject(error);
          return;
        }
        this.emit('error', error);
        return;
      }

      case 'room.joined':
      case 'room.left': {
        const request = this.takePending(frame.id);
        request?.resolve(frame);
        return;
      }

      case 'message':
        this.onLiveMessage(frame.message as ChatMessage);
        return;

      case 'message.updated':
        this.emit('messageUpdated', frame.message as ChatMessage);
        return;

      case 'message.deleted':
        this.emit('messageDeleted', {
          messageId: String(frame.messageId),
          roomId: String(frame.roomId),
          deletedAt: String(frame.deletedAt),
          deletedBy: (frame.deletedBy as string | null) ?? null,
        });
        return;

      case 'reaction.added':
      case 'reaction.removed': {
        const event: ReactionEvent = {
          messageId: String(frame.messageId),
          roomId: String(frame.roomId),
          userId: String(frame.userId),
          emoji: String(frame.emoji),
          at: String(frame.at),
        };
        this.emit(type === 'reaction.added' ? 'reactionAdded' : 'reactionRemoved', event);
        return;
      }

      case 'typing.started':
      case 'typing.stopped':
        this.emit('typing', {
          userId: String(frame.userId),
          roomId: String(frame.roomId),
          isTyping: type === 'typing.started',
        });
        return;

      case 'presence':
        this.emit('presence', {
          userId: String(frame.userId),
          roomId: String(frame.roomId),
          status: frame.status as PresenceStatus,
          at: String(frame.at),
        });
        return;

      case 'read':
        this.emit('read', {
          userId: String(frame.userId),
          roomId: String(frame.roomId),
          messageId: (frame.messageId as string | null) ?? null,
          at: String(frame.at),
        });
        return;

      case 'pong':
        return;

      default:
        // Forward compatibility. A newer server may send frames this
        // version has never heard of, and ignoring them beats throwing on
        // an upgrade nobody asked for.
        this.logger.debug(`ignoring unknown frame "${type}"`);
    }
  }

  private onServerHello(frame: Record<string, unknown>): void {
    this.connectionId = frame.connectionId as string;
    const wasReconnecting = this.hasConnectedBefore;
    this.hasConnectedBefore = true;

    this.setState('connected');
    this.scheduleTokenRefresh(frame.expiresAt as string | undefined);

    this.connectPromise?.resolve();
    this.connectPromise = undefined;

    if (wasReconnecting) {
      // Re-join whatever rooms the caller asked for — the new socket knows
      // nothing about the old one's subscriptions — and then replay
      // whatever arrived while this client was away.
      void this.syncRooms()
        .then(() => {
          this.emit('reconnected');
          return this.recoverMissedMessages();
        })
        .catch((error) => this.logger.warn(`reconnect handling failed: ${String(error)}`));
    } else {
      this.emit('connected');
    }
  }

  private handleClose(info: { code: number; reason: string; willReconnect: boolean; terminal: boolean }): void {
    this.connectionId = undefined;

    for (const [, request] of this.pending) {
      clearTimeout(request.timer);
      request.reject(new RavenChatConnectionError('Connection closed before the server replied', 'CONNECTION_CLOSED'));
    }
    this.pending.clear();

    if (info.willReconnect) {
      this.setState('reconnecting');
      return;
    }

    // `failed` is reserved for "retrying can't fix this": a rejected token,
    // or a reconnect ladder that ran out of rungs. An ordinary close is
    // `disconnected`, and to a developer those are different things.
    this.setState(info.terminal ? 'failed' : 'disconnected');
    this.emit('disconnected');
    // A connect() still in flight mustn't hang forever on a socket that's
    // never coming up.
    this.connectPromise?.reject(
      new RavenChatConnectionError(`Chat connection closed (${info.code})`, 'CONNECTION_CLOSED'),
    );
    this.connectPromise = undefined;
  }

  private fail(error: RavenChatError): void {
    this.setState('failed');
    this.connectPromise?.reject(error);
    this.connectPromise = undefined;
    this.emit('error', error);
  }

  /**
   * Every live message goes through here rather than straight to the
   * application, for two reasons.
   *
   * **De-duplication.** A message can legitimately arrive twice: once over
   * the socket just before it dropped, and again in the catch-up that
   * re-reads that window from history. The application must see it once.
   *
   * **Ordering.** While a catch-up is replaying older messages, a live one
   * arriving would otherwise be delivered ahead of them, and a sender's
   * messages would reach the application out of order — which is the one
   * ordering guarantee Livqeno actually makes. So live messages are held
   * until the replay finishes, then flushed in arrival order.
   */
  private onLiveMessage(message: ChatMessage): void {
    if (this.recovering) {
      const queued = this.pendingLive.get(message.roomId);
      if (queued) {
        queued.push(message);
      } else {
        this.pendingLive.set(message.roomId, [message]);
      }
      return;
    }

    if (this.recovery.accept(message)) {
      this.emit('message', message);
    }
  }

  /**
   * Replays what each room missed while this client was disconnected.
   *
   * Rooms are recovered concurrently and independently: they have separate
   * resume points, and one room failing — or being unreadable by this
   * token — must not hold up the others.
   *
   * Runs after `syncRooms()`, so the socket is already subscribed before
   * the catch-up starts. Anything that arrives during the catch-up is
   * buffered rather than dropped, which is what closes the window between
   * "history read" and "live again".
   */
  private async recoverMissedMessages(): Promise<void> {
    const rooms = Array.from(this.desiredRooms).filter((room) => this.recovery.has(room));
    if (rooms.length === 0) {
      // Nothing was ever delivered in these rooms, so there is no resume
      // point and nothing to catch up on. Still flush, in case a live
      // message arrived while we were deciding, and still report — an app
      // waiting on `recovered` to re-enable its UI must not hang just
      // because there happened to be nothing to recover.
      this.flushPendingLive();
      this.emit('recovered', { recovered: 0, perRoom: [], gap: false, errors: [] });
      return;
    }

    this.recovering = true;
    let perRoom: RoomRecoveryResult[] = [];
    try {
      perRoom = await Promise.all(rooms.map((room) => this.recovery.recoverRoom(room)));
    } finally {
      // Always release the buffer, even if a catch-up threw. Holding live
      // messages back forever would be a far worse failure than delivering
      // them slightly out of order.
      this.recovering = false;
      this.flushPendingLive();
    }

    const summary = {
      recovered: perRoom.reduce((total, result) => total + result.recovered, 0),
      perRoom,
      gap: perRoom.some((result) => result.gap),
      errors: perRoom.filter((result) => result.error !== undefined),
    };

    if (summary.recovered > 0 || summary.gap || summary.errors.length > 0) {
      this.logger.info(
        `recovered ${summary.recovered} missed message(s)` +
          (summary.gap ? ' (with a gap)' : '') +
          (summary.errors.length > 0 ? `; ${summary.errors.length} room(s) incomplete` : ''),
      );
    }
    this.emit('recovered', summary);
  }

  /** Delivers messages that arrived mid-catch-up, in the order they came in. */
  private flushPendingLive(): void {
    if (this.pendingLive.size === 0) return;
    const buffered = Array.from(this.pendingLive.values()).flat();
    this.pendingLive.clear();
    for (const message of buffered) {
      // De-duplicated against the catch-up, which may already have
      // delivered the very same message from history.
      if (this.recovery.accept(message)) {
        this.emit('message', message);
      }
    }
  }

  private async syncRooms(): Promise<void> {
    for (const room of this.desiredRooms) {
      try {
        await this.request('room.join', { room });
      } catch (error) {
        // One unauthorized room mustn't stop the rest from joining.
        this.emit('error', error instanceof RavenChatError ? error : toRavenChatError(undefined, String(error)));
      }
    }
  }

  /**
   * Refreshes the token shortly before it expires, assuming the app gave us
   * a way to fetch a new one. Without `onTokenExpiring` the socket just
   * closes at expiry. Correct, but abrupt, which is why this exists.
   */
  private scheduleTokenRefresh(expiresAt?: string): void {
    this.clearTokenRefreshTimer();
    if (!this.config.onTokenExpiring) return;

    const expiry = expiresAt ? Date.parse(expiresAt) : this.tokenExpiresAt;
    // A minute of headroom, never less than five seconds out, so a
    // short-lived token can't schedule its refresh in the past.
    const refreshAt = Math.max(expiry - 60_000, Date.now() + 5_000);

    this.tokenRefreshTimer = setTimeout(() => {
      void (async () => {
        try {
          const token = await this.config.onTokenExpiring!();
          const payload = decodeChatToken(token);
          this.currentUserId = payload.sub;
          this.tokenExpiresAt = payload.exp * 1000;
          this.rest.setToken(token);
          this.transport?.setToken(token);
          await this.reconnect();
        } catch (error) {
          this.emit(
            'error',
            error instanceof RavenChatError
              ? error
              : toRavenChatError('TOKEN_EXPIRED', 'Could not refresh the chat token'),
          );
        }
      })();
    }, refreshAt - Date.now());
  }

  private clearTokenRefreshTimer(): void {
    if (this.tokenRefreshTimer !== undefined) {
      clearTimeout(this.tokenRefreshTimer);
      this.tokenRefreshTimer = undefined;
    }
  }

  private takePending(id: unknown): PendingRequest | undefined {
    if (typeof id !== 'string') return undefined;
    const request = this.pending.get(id);
    if (!request) return undefined;
    clearTimeout(request.timer);
    this.pending.delete(id);
    return request;
  }
}

/**
 * Creates a chat client from a token your backend minted. The token already
 * carries the endpoint, the user identity and the permissions, which is why
 * it's usually the only argument you need.
 */
export function createChatClient(config: ChatClientConfig): ChatClient {
  return new ChatClient(validateConfig(config));
}

/** Distinct enough to work as an idempotency key, cheap enough for the hot path. */
function generateClientMessageId(): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `cm_${random}`;
}

export type { Unsubscribe, RavenMessageError };
