// Typed BFF client for `/v1/super-admin/chat/*` (spec §11) — platform-wide
// chat operations across every project. Deliberately mirrors the shapes
// `ChatService` on the API returns rather than reusing `ChatMessageSummary`
// et al. from `@/lib/api-client`: that file's types describe the
// project-scoped developer dashboard, and this one must never gain a field
// (like message content) that surface doesn't already expose.
import { buildQuery, superAdminFetch } from '@/lib/super-admin-client';

export type ConversationType = 'ROOM' | 'CHANNEL' | 'DIRECT';
export type ConversationStatus = 'ACTIVE' | 'ARCHIVED';
export type ChatMemberRole = 'MEMBER' | 'MODERATOR' | 'ADMIN';
export type ChatMemberStatus = 'ACTIVE' | 'LEFT';

export interface ChatTrendPoint {
  bucketStart: string;
  messages: number;
}

export interface ChatOverview {
  generatedAt: string;
  conversations: { total: number; active: number; archived: number };
  messages: { total: number; today: number; thisMonth: number };
  activeChatUsers: number;
  failedMessages: { today: number };
  throughput: { messagesPerMinuteLastHour: number };
  trends: {
    daily: ChatTrendPoint[];
    weekly: ChatTrendPoint[];
    monthly: ChatTrendPoint[];
  };
}

export interface ChatConversationListItem {
  id: string;
  projectId: string;
  projectName: string;
  name: string;
  type: ConversationType;
  status: ConversationStatus;
  memberCount: number;
  messageCount: number;
  lastMessageAt: string | null;
  createdAt: string;
}

export interface ChatConversationPage {
  items: ChatConversationListItem[];
  total: number;
}

/**
 * Never a `content` field — enforced upstream by `ChatService`'s Prisma
 * `select`, mirrored here so this type can't even describe a response
 * shape that carries message text.
 */
export interface ChatConversationMember {
  userId: string;
  role: ChatMemberRole;
  status: ChatMemberStatus;
  joinedAt: string;
  leftAt: string | null;
}

export interface ChatConversationDetail extends ChatConversationListItem {
  updatedAt: string;
  retentionDays: number | null;
  members: ChatConversationMember[];
}

export interface ListChatConversationsParams {
  projectId?: string;
  status?: ConversationStatus;
  type?: ConversationType;
  search?: string;
  limit?: number;
  offset?: number;
}

export function getChatOverview(token: string): Promise<ChatOverview> {
  return superAdminFetch<ChatOverview>('/v1/super-admin/chat/overview', { token });
}

export function listChatConversations(
  token: string,
  params: ListChatConversationsParams = {},
): Promise<ChatConversationPage> {
  const query = buildQuery({
    projectId: params.projectId,
    status: params.status,
    type: params.type,
    search: params.search,
    limit: params.limit,
    offset: params.offset,
  });
  return superAdminFetch<ChatConversationPage>(`/v1/super-admin/chat/conversations${query}`, { token });
}

/**
 * Hits the permission-restricted detail route — a 403 here means the
 * signed-in admin holds SUPPORT/READ_ONLY, not SUPER_ADMIN/ADMIN. Callers
 * should treat that the same as any other `ApiError`, not as "not found".
 */
export function getChatConversation(token: string, id: string): Promise<ChatConversationDetail> {
  return superAdminFetch<ChatConversationDetail>(
    `/v1/super-admin/chat/conversations/${encodeURIComponent(id)}`,
    { token },
  );
}
