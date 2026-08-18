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
  /** A message arrived — including your own, echoed back with its canonical id. */
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
  error: (error: RavenChatError) => void;
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
 * The Raven Chat client.
 *
 * A developer never constructs a `WebSocket`, never reconnects by hand,
 * never sees a frame type, and never learns which gateway instance is
 * holding their socket (spec §2, §12). What's here is the whole API:
 * connect, send, listen, and the `messages` namespace for history and
 * per-message operations.
 */
export class ChatClient extends TypedEventEmitter<ChatEventMap> {
  /** History, editing, reactions, threads. Grouped so the top level stays small. */
  readonly messages: MessagesApi;
  /** Signed uploads and downloads. Bytes never touch the WebSocket. */
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

  /** Rooms the caller asked to be in, re-joined automatically after a reconnect. */
  private readonly desiredRooms = new Set<string>();
  private readonly pending = new Map<string, PendingRequest>();
  private requestCounter = 0;
  /** Resolves on the first `connected` frame, so `await connect()` means "really connected". */
  private connectPromise?: { resolve: () => void; reject: (error: unknown) => void };
  private hasConnectedBefore = false;
  /** Local stop-typing timers, so a dropped `typing.stop` can't leave one stuck. */
  private readonly typingTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** @internal use `createChatClient(config)`. The second parameter only exists so tests can inject a fake socket. */
  constructor(config: ResolvedChatClientConfig, socketFactory?: WebSocketFactory) {
    super();
    this.config = config;
    this.logger = createLogger(config.logLevel);
    this.rest = new RestClient(config.apiUrl, config.token);
    this.socketFactory = socketFactory;
    this.messages = new MessagesApi(this.rest, () => this.defaultRoom(), (options) => this.sendMessage(options));
    this.attachments = new AttachmentsApi(this.rest, () => this.defaultRoom());

    const payload = decodeChatToken(config.token);
    this.currentUserId = payload.sub;
    this.tokenExpiresAt = payload.exp * 1000;
  }

  /** The user this client speaks as, from the token. Never settable from here. */
  get userId(): string {
    return this.currentUserId;
  }

  get connectionState(): ChatConnectionState {
    return this.state;
  }

  /** Stable for the life of one socket; changes on reconnect. Quote it in bug reports. */
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
   * Opens the connection and joins the requested rooms. Resolves once the
   * server has authenticated the socket — not merely when TCP opened, so
   * a resolved `connect()` genuinely means you can send.
   */
  async connect(options: ConnectOptions = {}): Promise<void> {
    for (const room of [...(options.room ? [options.room] : []), ...(options.rooms ?? [])]) {
      this.desiredRooms.add(room);
    }

    if (this.state === 'connected') {
      // Already up — just make sure the newly-requested rooms are joined.
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

  /** Closes the connection. Does not reconnect; call `connect()` again to come back. */
  async disconnect(): Promise<void> {
    this.clearTokenRefreshTimer();
    for (const timer of this.typingTimers.values()) clearTimeout(timer);
    this.typingTimers.clear();

    // Reject anything still waiting rather than leaving callers hanging
    // on a promise that can no longer resolve.
    for (const [, request] of this.pending) {
      clearTimeout(request.timer);
      request.reject(new RavenChatConnectionError('Connection closed before the server replied', 'CONNECTION_CLOSED'));
    }
    this.pending.clear();

    this.transport?.disconnect();
    this.transport = undefined;
    this.connectionId = undefined;
    this.setState('disconnected');
  }

  /**
   * Force a reconnect now. Rarely needed — the SDK reconnects on its own
   * — but useful after the app knows the network changed (a `online`
   * event, say) and doesn't want to wait out the backoff.
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
    if (this.state === 'connected') {
      await this.request('room.leave', { room });
    }
  }

  // -------------------------------------------------------------------------
  // Messaging
  // -------------------------------------------------------------------------

  /**
   * Sends a message and resolves with the stored message — canonical
   * server id, canonical timestamp. It resolves only after Raven has
   * durably stored it, so a resolved promise really does mean "saved"
   * (spec §15).
   *
   * A `clientMessageId` is attached automatically if you don't supply
   * one, which is what makes a retry after a reconnect safe (spec §16).
   */
  async sendMessage(options: SendMessageOptions): Promise<SendMessageResult> {
    const room = options.room ?? this.defaultRoom();

    // Over HTTP when the socket isn't up: the message still gets stored
    // and fanned out to everyone else. Losing a connection shouldn't
    // silently lose the thing the user just typed.
    if (this.state !== 'connected') {
      return this.rest.request<SendMessageResult>(
        `/v1/chat/conversations/${encodeURIComponent(room)}/messages`,
        { method: 'POST', body: { ...options, room: undefined, clientMessageId: options.clientMessageId ?? generateClientMessageId() } },
      );
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
   * Signals that this user is typing. Safe to call on every keystroke —
   * the server only broadcasts on the transition into "typing", and this
   * arms a local timer that stops it automatically, so a user who wanders
   * off mid-sentence doesn't stay "typing…" forever (spec §21).
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

  /** Marks this message — and everything before it — as read. */
  async markAsRead(messageId: string): Promise<ReadState> {
    if (this.state === 'connected') {
      return this.request<ReadState>('read.mark', { messageId });
    }
    return this.rest.request<ReadState>(`/v1/chat/messages/${encodeURIComponent(messageId)}/read`, {
      method: 'POST',
    });
  }

  /** Sets presence across every room this connection holds. */
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

  /** Everyone's read position — what a "seen by" row is built from. */
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
        'No room selected — pass { room } to connect(), or a `room` option on this call',
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
      // Typing and presence are ephemeral by nature. Queuing them to
      // replay after a reconnect would deliver stale signals, so they're
      // dropped on purpose rather than buffered.
      this.logger.debug(`dropped ${type} — not connected`);
      return;
    }
    this.transport.send({ type, ...payload });
  }

  /** Sends a frame and waits for its correlated ack, with a timeout. */
  private request<T = unknown>(type: string, payload: Record<string, unknown>): Promise<T> {
    if (!this.transport?.isOpen) {
      return Promise.reject(
        new RavenChatConnectionError('Not connected — call connect() first', 'CONNECTION_CLOSED'),
      );
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
          // Correlated to a call the developer made — reject their
          // promise rather than firing a global error they can't tie back.
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
        this.emit('message', frame.message as ChatMessage);
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
        // Forward compatibility: a newer server may send frames this
        // version doesn't know. Ignoring them beats throwing on an
        // upgrade the developer didn't ask for.
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
      // Re-join rooms the caller asked for; the new socket knows nothing
      // about the old one's subscriptions.
      void this.syncRooms().then(() => this.emit('reconnected'));
    } else {
      this.emit('connected');
    }
  }

  private handleClose(info: { code: number; reason: string; willReconnect: boolean; terminal: boolean }): void {
    this.connectionId = undefined;

    for (const [, request] of this.pending) {
      clearTimeout(request.timer);
      request.reject(
        new RavenChatConnectionError('Connection closed before the server replied', 'CONNECTION_CLOSED'),
      );
    }
    this.pending.clear();

    if (info.willReconnect) {
      this.setState('reconnecting');
      return;
    }

    // `failed` is reserved for "retrying cannot fix this" — a rejected
    // token, or a reconnect ladder that ran out. An ordinary close is
    // `disconnected`, which is a different thing to a developer.
    this.setState(info.terminal ? 'failed' : 'disconnected');
    this.emit('disconnected');
    // A connect() still in flight must not hang forever on a socket that
    // is never coming up.
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

  private async syncRooms(): Promise<void> {
    for (const room of this.desiredRooms) {
      try {
        await this.request('room.join', { room });
      } catch (error) {
        // One unauthorized room must not stop the others from joining.
        this.emit('error', error instanceof RavenChatError ? error : toRavenChatError(undefined, String(error)));
      }
    }
  }

  /**
   * Refreshes the token shortly before it expires, if the app gave us a
   * way to get a new one. Without `onTokenExpiring`, the socket simply
   * closes at expiry — correct, but abrupt, so this exists to make the
   * good path easy.
   */
  private scheduleTokenRefresh(expiresAt?: string): void {
    this.clearTokenRefreshTimer();
    if (!this.config.onTokenExpiring) return;

    const expiry = expiresAt ? Date.parse(expiresAt) : this.tokenExpiresAt;
    // A minute of headroom, and never less than five seconds out, so a
    // short-lived token can't schedule a refresh in the past.
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
 * Creates a chat client from a token your backend minted. The token
 * carries the endpoint, the user identity, and the permissions — which is
 * why this is usually the only argument.
 */
export function createChatClient(config: ChatClientConfig): ChatClient {
  return new ChatClient(validateConfig(config));
}

/** Distinct enough to be a real idempotency key, cheap enough for the hot path. */
function generateClientMessageId(): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `cm_${random}`;
}

export type { Unsubscribe, RavenMessageError };
