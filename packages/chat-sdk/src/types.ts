/** Message kinds Raven understands today. Widened, not broken, when new ones land. */
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
 * A message, exactly as the server stored it. `id` and `createdAt` are
 * always the server's — the SDK never invents either, which is what makes
 * ordering consistent across every client in a room.
 */
export interface ChatMessage {
  /** Raven's canonical `msg_...` id. */
  id: string;
  /** The conversation's public id, the same value you passed to `connect({ room })`. */
  roomId: string;
  conversationId: string;
  senderId: string;
  type: ChatMessageType;
  /** `null` for messages that carry no text, and for deleted ones. */
  text: string | null;
  /** `msg_...` id of the message this replies to. */
  replyTo: string | null;
  /** The thread this message belongs to; equals the root message's id. */
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
 * Connection states, mirroring `@corvidhq/rtc`'s vocabulary so a developer
 * using both doesn't have to learn two.
 *
 * `failed` is terminal: reconnect attempts are exhausted, or the failure
 * is one retrying can't fix (a revoked token). `disconnected` means the
 * connection ended and nothing is being retried.
 */
export type ChatConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'failed';

export interface ReadState {
  roomId: string;
  userId: string;
  lastReadMessageId: string | null;
  lastReadAt: string;
  unreadCount: number;
}

export interface MessagePage {
  data: ChatMessage[];
  /** Pass as `before` to fetch the next (older) page. `null` at the end of history. */
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
   * Your own idempotency key. Retrying a send with the same key returns
   * the original message instead of creating a duplicate — set it if you
   * retry sends yourself. The SDK sets one automatically for its own
   * internal retries.
   */
  clientMessageId?: string;
  /** `att_...` id from `chat.attachments.create()`, already uploaded. */
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
  /** `true` when an idempotency key matched an existing message — nothing new was written. */
  deduplicated?: boolean;
}
