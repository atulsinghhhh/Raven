/** Message kinds Livqeno understands today. New ones widen this; they don't break it. */
export type ChatMessageType = 'text' | 'system' | 'event' | 'attachment';

export interface ChatAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  storageKey: string;
  status: 'pending' | 'uploaded' | 'expired';
}

export interface ChatReaction {
  emoji: string;
  count: number;
  userIds: string[];
}

/**
 * A message, exactly as the server stored it.
 *
 * `id` and `createdAt` are always the server's. The SDK never invents
 * either, and that's what keeps ordering consistent across every client in
 * a room.
 */
export interface ChatMessage {
  /** Livqeno's canonical `msg_...` id. */
  id: string;
  /**
   * Opaque resume point. Pass it as `after` to `messages.list()` to fetch
   * everything that came after this message.
   *
   * You rarely need it: the SDK recovers missed messages by itself on
   * reconnect and this is what it uses. It is here for apps that persist
   * their own read position across page loads and want to resume from it.
   *
   * Treat it as opaque — it is a value pair, not an id, and the encoding is
   * ours to change.
   */
  cursor: string;
  /** The conversation's public id, the same value you passed to `connect({ room })`. */
  roomId: string;
  conversationId: string;
  senderId: string;
  type: ChatMessageType;
  /** `null` for messages that carry no text, and for deleted ones. */
  text: string | null;
  /** `msg_...` id of the message this replies to. */
  replyTo: string | null;
  /** The thread this message belongs to. Same as the root message's id. */
  threadRootId: string | null;
  /** Whatever you passed as `clientMessageId`, echoed back. */
  clientMessageId: string | null;
  metadata: Record<string, unknown> | null;
  attachment: ChatAttachment | null;
  reactions: ChatReaction[];
  edited: boolean;
  deleted: boolean;
  createdAt: string;
  updatedAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

export type PresenceStatus = 'online' | 'away' | 'offline';

export interface PresenceEvent {
  userId: string;
  status: PresenceStatus;
  roomId: string;
  at: string;
}

export interface TypingEvent {
  userId: string;
  roomId: string;
  /** `true` for typing.started, `false` for typing.stopped. */
  isTyping: boolean;
}

export interface ReadReceiptEvent {
  userId: string;
  roomId: string;
  messageId: string | null;
  at: string;
}

export interface ReactionEvent {
  messageId: string;
  roomId: string;
  userId: string;
  emoji: string;
  at: string;
}

export interface MessageDeletedEvent {
  messageId: string;
  roomId: string;
  deletedAt: string;
  deletedBy: string | null;
}

/**
 * Connection states, using `@ravenkash/rtc`'s vocabulary so anyone on both
 * doesn't have to learn two.
 *
 * `failed` is terminal: either reconnect attempts ran out, or the failure
 * is one retrying can't fix, like a revoked token. `disconnected` means the
 * connection ended and nothing is being retried.
 */
export type ChatConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'failed';

export interface ReadState {
  roomId: string;
  userId: string;
  lastReadMessageId: string | null;
  lastReadAt: string;
  unreadCount: number;
}

export interface MessagePage {
  data: ChatMessage[];
  /** Pass as `before` to fetch the next, older page. `null` once history runs out. */
  nextCursor: string | null;
  /** Pass as `after` to walk forward toward newer messages. */
  previousCursor: string | null;
  hasMore: boolean;
}

export interface SendMessageOptions {
  text?: string;
  type?: ChatMessageType;
  /** `msg_...` id to reply to. The reply joins that message's thread. */
  replyTo?: string;
  /**
   * Your own idempotency key. Retry a send with the same key and you get
   * the original message back instead of a duplicate. Set it if you retry
   * sends yourself; the SDK sets one automatically for its own retries.
   */
  clientMessageId?: string;
  /** `att_...` id from `chat.attachments.upload()`, already uploaded. */
  attachmentId?: string;
  metadata?: Record<string, unknown>;
  /** Which room to send to. Defaults to the room passed to `connect()`. */
  room?: string;
}

export interface ListMessagesOptions {
  room?: string;
  limit?: number;
  before?: string;
  after?: string;
  threadRootId?: string;
  senderId?: string;
  includeDeleted?: boolean;
}

/** What the server confirmed once a message was durably stored. */
export interface SendMessageResult extends ChatMessage {
  /** `true` when an idempotency key matched an existing message, so nothing new got written. */
  deduplicated?: boolean;
}
