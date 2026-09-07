import { ChatServerFrame, PresenceStatus } from '../chat.constants';

/**
 * A message as it appears to a developer. Nothing internal leaks: no
 * database uuid, no Prisma model, no transport type. `id` is the public
 * `msg_...` id, and `roomId` is the conversation's public id — the same
 * string the developer passed to `chat.connect({ room })`.
 */
export interface ChatMessageView {
  id: string;
  roomId: string;
  conversationId: string;
  senderId: string;
  type: 'text' | 'system' | 'event' | 'attachment';
  text: string | null;
  replyTo: string | null;
  threadRootId: string | null;
  clientMessageId: string | null;
  metadata: Record<string, unknown> | null;
  attachment: ChatAttachmentView | null;
  reactions: ChatReactionSummary[];
  edited: boolean;
  deleted: boolean;
  createdAt: string;
  updatedAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

export interface ChatAttachmentView {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  /** Opaque object-storage key. Bytes are only reachable through a signed URL. */
  storageKey: string;
  status: 'pending' | 'uploaded' | 'expired';
}

export interface ChatReactionSummary {
  emoji: string;
  count: number;
  userIds: string[];
}

/**
 * What travels over Redis pub/sub between gateway instances, and (minus
 * the routing envelope) out to clients. One shape for both so there is no
 * translation layer to get out of sync.
 */
export type ChatRealtimeEvent =
  | { type: ChatServerFrame.MESSAGE; conversationId: string; message: ChatMessageView }
  | { type: ChatServerFrame.MESSAGE_UPDATED; conversationId: string; message: ChatMessageView }
  | {
      type: ChatServerFrame.MESSAGE_DELETED;
      conversationId: string;
      roomId: string;
      messageId: string;
      deletedAt: string;
      deletedBy: string | null;
    }
  | {
      type: ChatServerFrame.REACTION_ADDED;
      conversationId: string;
      roomId: string;
      messageId: string;
      userId: string;
      emoji: string;
      at: string;
    }
  | {
      type: ChatServerFrame.REACTION_REMOVED;
      conversationId: string;
      roomId: string;
      messageId: string;
      userId: string;
      emoji: string;
      at: string;
    }
  | {
      type: ChatServerFrame.TYPING_STARTED | ChatServerFrame.TYPING_STOPPED;
      conversationId: string;
      roomId: string;
      userId: string;
    }
  | {
      type: ChatServerFrame.PRESENCE;
      conversationId: string;
      roomId: string;
      userId: string;
      status: PresenceStatus;
      at: string;
    }
  | {
      type: ChatServerFrame.READ;
      conversationId: string;
      roomId: string;
      userId: string;
      messageId: string | null;
      at: string;
    };

/**
 * Wraps an event with the metadata a receiving gateway needs but a client
 * must never see. `originConnectionId` lets a gateway skip echoing an
 * event back to the socket that caused it where that's the right
 * behaviour (typing, presence) — messages are always echoed, so the
 * sender sees the same canonical, server-ordered row everyone else does.
 */
export interface ChatEventEnvelope {
  event: ChatRealtimeEvent;
  projectId: string;
  originConnectionId?: string;
  /** Server-side publish time, used to measure fan-out latency (spec §48). */
  publishedAt: number;
}
