import type { RestClient } from './internal/rest-client';
import type {
  ChatMessage,
  ChatReaction,
  ListMessagesOptions,
  MessagePage,
  SendMessageOptions,
  SendMessageResult,
} from './types';

/**
 * `chat.messages.*`: everything that operates on messages, not on
 * the connection.
 *
 * Grouped into a namespace so the top-level client stays small enough to
 * read in one screen, and so `chat.messages.list()` reads the way the docs
 * describe it (spec §17).
 *
 * These go over HTTP, not the socket. Paginating history through a frame
 * queue would block real-time delivery behind a scroll, and history is
 * precisely what you want when the socket *isn't* up.
 */
export class MessagesApi {
  constructor(
    private readonly rest: RestClient,
    private readonly defaultRoom: () => string,
    private readonly sendMessage: (options: SendMessageOptions) => Promise<SendMessageResult>,
    /**
     * Lets the client note where history reached, so a room a developer
     * paged through has a resume point even if no live message has arrived
     * in it yet. Without this, a quiet room that drops its socket right
     * after a page load has nothing to recover from.
     */
    private readonly onPage?: (page: MessagePage) => void,
  ) {}

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
  async list(options: ListMessagesOptions = {}): Promise<MessagePage> {
    const page = await this.listRaw(options);
    this.onPage?.(page);
    return page;
  }

  /**
   * `list()` without the bookkeeping, for the SDK's own catch-up.
   *
   * Same endpoint, same credential, same authorization — the only
   * difference is that it does not advance the resume point. Recovery has
   * to advance that itself, one message at a time as each is actually
   * delivered, so a socket dropping mid-catch-up cannot leave the cursor
   * ahead of what the application has seen.
   *
   * @internal
   */
  listRaw(options: ListMessagesOptions = {}): Promise<MessagePage> {
    const room = options.room ?? this.defaultRoom();
    return this.rest.request<MessagePage>(`/v1/chat/conversations/${encodeURIComponent(room)}/messages`, {
      query: {
        limit: options.limit,
        before: options.before,
        after: options.after,
        threadRootId: options.threadRootId,
        senderId: options.senderId,
        includeDeleted: options.includeDeleted,
      },
    });
  }

  /** Also available as `chat.sendMessage(...)`; both are the same call. */
  send(options: SendMessageOptions): Promise<SendMessageResult> {
    return this.sendMessage(options);
  }

  get(messageId: string): Promise<ChatMessage> {
    return this.rest.request<ChatMessage>(`/v1/chat/messages/${encodeURIComponent(messageId)}`);
  }

  /**
   * Every message in this message's thread, oldest first: the root and its
   * replies. Threads live in the same store as everything else, so this is
   * a filtered read, not a separate system (spec §26).
   */
  thread(messageId: string): Promise<ChatMessage[]> {
    return this.rest.request<ChatMessage[]>(`/v1/chat/messages/${encodeURIComponent(messageId)}/thread`);
  }

  /**
   * Edits a message. What comes back carries `edited: true` and an
   * `editedAt`. Livqeno never quietly rewrites history (spec §24).
   */
  update(messageId: string, changes: { text?: string; metadata?: Record<string, unknown> }): Promise<ChatMessage> {
    return this.rest.request<ChatMessage>(`/v1/chat/messages/${encodeURIComponent(messageId)}`, {
      method: 'PATCH',
      body: changes,
    });
  }

  /**
   * Soft-deletes a message. It keeps its position and its id but loses its
   * body, so clients can render a placeholder instead of a hole opening up
   * in the middle of a conversation (spec §25).
   */
  delete(messageId: string): Promise<ChatMessage> {
    return this.rest.request<ChatMessage>(`/v1/chat/messages/${encodeURIComponent(messageId)}`, {
      method: 'DELETE',
    });
  }

  /** Adding the same reaction twice is a no-op, not a duplicate. */
  addReaction(messageId: string, emoji: string): Promise<{ reactions: ChatReaction[] }> {
    return this.rest.request(`/v1/chat/messages/${encodeURIComponent(messageId)}/reactions`, {
      method: 'POST',
      body: { emoji },
    });
  }

  removeReaction(messageId: string, emoji: string): Promise<{ reactions: ChatReaction[] }> {
    return this.rest.request(
      `/v1/chat/messages/${encodeURIComponent(messageId)}/reactions/${encodeURIComponent(emoji)}`,
      { method: 'DELETE' },
    );
  }
}
