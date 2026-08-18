import type { RavenHttpClient } from '../http-client';
import type {
  ChatConversation,
  ChatMember,
  ChatMessage,
  ChatMessagePage,
  CreateChatTokenParams,
  CreateConversationParams,
  IssuedChatToken,
  ListChatMessagesParams,
  SendChatMessageParams,
} from '../types';

/**
 * Raven Chat, server-side (Phase 12).
 *
 * The important method here is `tokens.create()` — the whole security
 * model rests on it. Your backend authenticates the user *its* way, then
 * asks Raven for a short-lived token scoped to that one user, and only
 * that token reaches the browser. The project API key never does.
 *
 * The rest exists for the things a backend genuinely needs to do:
 * provision conversations, manage membership, post system messages, and
 * read history for export or moderation.
 */
export class ChatResource {
  constructor(private readonly http: RavenHttpClient) {}

  /**
   * Mints a browser-safe chat token.
   *
   * `scopes` can only ever *narrow* what the user's role already allows —
   * listing `chat:moderate` here does not grant it. That makes it safe to
   * pass through from a caller without re-checking.
   */
  createToken(params: CreateChatTokenParams): Promise<IssuedChatToken> {
    return this.http.request<IssuedChatToken>('/v1/chat/tokens', {
      method: 'POST',
      body: {
        userId: params.userId,
        conversations: params.conversations,
        scopes: params.scopes,
        ttlSeconds: params.expiresIn,
      },
    });
  }

  /** Creates a conversation. Pass `roomId` to attach it to an RTC room, giving that call a chat panel. */
  createConversation(params: CreateConversationParams): Promise<ChatConversation> {
    return this.http.request<ChatConversation>('/v1/chat/conversations', {
      method: 'POST',
      body: params,
    });
  }

  listConversations(): Promise<ChatConversation[]> {
    return this.http.request<ChatConversation[]>('/v1/chat/conversations');
  }

  /** `room` accepts a `conv_...` id, the conversation name, or an attached RTC room id. */
  getConversation(room: string): Promise<ChatConversation> {
    return this.http.request<ChatConversation>(`/v1/chat/conversations/${encodeURIComponent(room)}`);
  }

  addMember(room: string, params: { userId: string; role?: 'MEMBER' | 'MODERATOR' | 'ADMIN' }): Promise<ChatMember> {
    return this.http.request<ChatMember>(`/v1/chat/conversations/${encodeURIComponent(room)}/members`, {
      method: 'POST',
      body: params,
    });
  }

  removeMember(room: string, userId: string): Promise<void> {
    return this.http.request<void>(
      `/v1/chat/conversations/${encodeURIComponent(room)}/members/${encodeURIComponent(userId)}`,
      { method: 'DELETE' },
    );
  }

  listMembers(room: string): Promise<ChatMember[]> {
    return this.http.request<ChatMember[]>(`/v1/chat/conversations/${encodeURIComponent(room)}/members`);
  }

  /**
   * Posts a message as any user in the project — which is why this is
   * server-only. `type: 'system'` is available here and nowhere else: a
   * browser must never be able to fabricate a system announcement.
   */
  sendMessage(room: string, params: SendChatMessageParams): Promise<ChatMessage> {
    return this.http.request<ChatMessage>(`/v1/chat/conversations/${encodeURIComponent(room)}/messages`, {
      method: 'POST',
      body: params,
    });
  }

  /** Cursor-paginated history. Use `before` to page back; never an offset. */
  listMessages(room: string, params: ListChatMessagesParams = {}): Promise<ChatMessagePage> {
    const query = new URLSearchParams();
    if (params.limit !== undefined) query.set('limit', String(params.limit));
    if (params.before) query.set('before', params.before);
    if (params.after) query.set('after', params.after);
    if (params.senderId) query.set('senderId', params.senderId);
    if (params.includeDeleted) query.set('includeDeleted', 'true');

    const suffix = query.toString() ? `?${query.toString()}` : '';
    return this.http.request<ChatMessagePage>(
      `/v1/chat/conversations/${encodeURIComponent(room)}/messages${suffix}`,
    );
  }

  /** Soft-deletes a message. Moderation action — the row survives with a `deletedAt`. */
  deleteMessage(messageId: string): Promise<ChatMessage> {
    return this.http.request<ChatMessage>(`/v1/chat/messages/${encodeURIComponent(messageId)}`, {
      method: 'DELETE',
    });
  }
}
