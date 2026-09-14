import { Injectable } from '@nestjs/common';
import {
  ActivityEventType,
  ChatMemberRole,
  ChatMemberStatus,
  ConnectionState,
  ConversationStatus,
  ConversationType,
} from '../../../generated/prisma/enums';
import { PrismaService } from '../../../shared/database/prisma.service';
import { QueryChatConversationsDto } from './dto/query-chat-conversations.dto';

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const DAILY_TREND_DAYS = 14;
const WEEKLY_TREND_WEEKS = 8;
const MONTHLY_TREND_MONTHS = 6;
/** Members list is capped, same ceiling `DashboardChatController` uses for one project's conversation. */
const MAX_MEMBERS = 500;

export interface ChatTrendPoint {
  /** ISO instant marking the start of the bucket (day/week/month), UTC. */
  bucketStart: string;
  messages: number;
}

export interface ChatOverviewResponse {
  generatedAt: string;
  conversations: {
    total: number;
    active: number;
    archived: number;
  };
  messages: {
    total: number;
    today: number;
    thisMonth: number;
  };
  /** Distinct users holding a CONNECTED chat WebSocket right now, across every project. */
  activeChatUsers: number;
  failedMessages: {
    today: number;
  };
  throughput: {
    /** Messages stored per minute, averaged over the trailing hour. */
    messagesPerMinuteLastHour: number;
  };
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

export interface ChatConversationMemberSummary {
  userId: string;
  role: ChatMemberRole;
  status: ChatMemberStatus;
  joinedAt: string;
  leftAt: string | null;
}

export interface ChatConversationDetail extends ChatConversationListItem {
  updatedAt: string;
  retentionDays: number | null;
  members: ChatConversationMemberSummary[];
}

/**
 * Platform-wide chat operations (spec §11) — every project at once, unlike
 * `DashboardChatController`, which is scoped to the one project a
 * developer owns. Same non-negotiable privacy rule carries over
 * unchanged: `Message.content` is never selected, returned, or rendered
 * anywhere in this service. Only counts, timestamps, sender/member ids,
 * and status make it into a response — see that controller's own comment
 * for the reasoning this mirrors.
 */
@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(): Promise<ChatOverviewResponse> {
    const now = new Date();
    const startOfDay = startOfDayUtc(now);
    const startOfMonth = startOfMonthUtc(now);
    const oneHourAgo = new Date(now.getTime() - HOUR_MS);

    const [
      totalConversations,
      activeConversations,
      archivedConversations,
      totalMessages,
      messagesToday,
      messagesThisMonth,
      activeChatUserRows,
      failedMessagesToday,
      messagesLastHour,
      daily,
      weekly,
      monthly,
    ] = await Promise.all([
      this.prisma.conversation.count(),
      this.prisma.conversation.count({ where: { status: ConversationStatus.ACTIVE } }),
      this.prisma.conversation.count({ where: { status: ConversationStatus.ARCHIVED } }),
      this.prisma.message.count({ where: { deletedAt: null } }),
      this.prisma.message.count({ where: { deletedAt: null, createdAt: { gte: startOfDay } } }),
      this.prisma.message.count({ where: { deletedAt: null, createdAt: { gte: startOfMonth } } }),
      this.prisma.chatConnection.findMany({
        where: { state: ConnectionState.CONNECTED },
        select: { userId: true },
        distinct: ['userId'],
      }),
      // Best effort: CHAT_MESSAGE_FAILED isn't wired into the hot chat send
      // path yet (implementation-plan.md §4), so this is expected to read 0
      // today. That is the real count, not a fabricated one — it starts
      // reflecting reality the moment a future pass emits that event.
      this.prisma.activityEvent.count({
        where: { eventType: ActivityEventType.CHAT_MESSAGE_FAILED, createdAt: { gte: startOfDay } },
      }),
      this.prisma.message.count({ where: { deletedAt: null, createdAt: { gte: oneHourAgo } } }),
      this.countBuckets(dailyBuckets(now)),
      this.countBuckets(weeklyBuckets(now)),
      this.countBuckets(monthlyBuckets(now)),
    ]);

    return {
      generatedAt: now.toISOString(),
      conversations: {
        total: totalConversations,
        active: activeConversations,
        archived: archivedConversations,
      },
      messages: {
        total: totalMessages,
        today: messagesToday,
        thisMonth: messagesThisMonth,
      },
      activeChatUsers: activeChatUserRows.length,
      failedMessages: { today: failedMessagesToday },
      throughput: {
        messagesPerMinuteLastHour: round2(messagesLastHour / 60),
      },
      trends: { daily, weekly, monthly },
    };
  }

  async listConversations(query: QueryChatConversationsDto): Promise<ChatConversationPage> {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = Math.max(query.offset ?? 0, 0);

    const where = {
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' as const } } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.conversation.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: {
          project: { select: { name: true } },
          _count: { select: { messages: true, members: true } },
          messages: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'desc' },
            take: 1,
            // Timestamp only: this list is activity-at-a-glance, not a
            // message reader. No `senderId` needed here either — that
            // level of detail lives behind the permission-restricted
            // detail route below.
            select: { createdAt: true },
          },
        },
      }),
      this.prisma.conversation.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.publicId,
        projectId: row.projectId,
        projectName: row.project.name,
        name: row.name,
        type: row.type,
        status: row.status,
        memberCount: row._count.members,
        messageCount: row._count.messages,
        lastMessageAt: row.messages[0]?.createdAt.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
    };
  }

  /**
   * The permission-restricted "deeper inspection" route (spec §11): names
   * individual member user ids, so it sits behind
   * `@RequirePlatformRole(SUPER_ADMIN, ADMIN)` at the controller and every
   * call is written to `AdminAuditLog` there. Still never touches
   * `Message.content` — only the same aggregate count the list view
   * already shows, plus the member roster.
   */
  async getConversation(publicId: string): Promise<ChatConversationDetail | null> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { publicId },
      include: {
        project: { select: { name: true } },
        _count: { select: { messages: true, members: true } },
        messages: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true },
        },
      },
    });
    if (!conversation) return null;

    const members = await this.prisma.chatMember.findMany({
      where: { conversationId: conversation.id },
      orderBy: { joinedAt: 'asc' },
      take: MAX_MEMBERS,
    });

    return {
      id: conversation.publicId,
      projectId: conversation.projectId,
      projectName: conversation.project.name,
      name: conversation.name,
      type: conversation.type,
      status: conversation.status,
      memberCount: conversation._count.members,
      messageCount: conversation._count.messages,
      lastMessageAt: conversation.messages[0]?.createdAt.toISOString() ?? null,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
      retentionDays: conversation.retentionDays,
      members: members.map((member) => ({
        userId: member.userId,
        role: member.role,
        status: member.status,
        joinedAt: member.joinedAt.toISOString(),
        leftAt: member.leftAt?.toISOString() ?? null,
      })),
    };
  }

  /**
   * Runs one `count()` per bucket rather than a single grouped raw query:
   * with at most 14 buckets this stays cheap, and it keeps every number on
   * this page produced by the same plain `count()`/`findMany()` shapes
   * `OverviewService` already uses — no `$queryRaw` date-bucketing
   * introduced just for this one page.
   */
  private async countBuckets(buckets: { start: Date; end: Date }[]): Promise<ChatTrendPoint[]> {
    const counts = await Promise.all(
      buckets.map((bucket) =>
        this.prisma.message.count({
          where: { deletedAt: null, createdAt: { gte: bucket.start, lt: bucket.end } },
        }),
      ),
    );
    return buckets.map((bucket, i) => ({ bucketStart: bucket.start.toISOString(), messages: counts[i] }));
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function startOfDayUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function addDaysUtc(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/** Most recent Monday, 00:00 UTC — matches `OverviewService`'s own week start. */
function startOfWeekUtc(now: Date): Date {
  const start = startOfDayUtc(now);
  const day = start.getUTCDay(); // 0 = Sunday ... 6 = Saturday
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  return addDaysUtc(start, -daysSinceMonday);
}

function startOfMonthUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Last 14 UTC days, oldest first, including today as the final bucket. */
function dailyBuckets(now: Date): { start: Date; end: Date }[] {
  const today = startOfDayUtc(now);
  return Array.from({ length: DAILY_TREND_DAYS }, (_, i) => {
    const start = addDaysUtc(today, i - (DAILY_TREND_DAYS - 1));
    return { start, end: addDaysUtc(start, 1) };
  });
}

/** Last 8 Monday-start UTC weeks, oldest first, including the current week. */
function weeklyBuckets(now: Date): { start: Date; end: Date }[] {
  const currentWeekStart = startOfWeekUtc(now);
  return Array.from({ length: WEEKLY_TREND_WEEKS }, (_, i) => {
    const start = addDaysUtc(currentWeekStart, (i - (WEEKLY_TREND_WEEKS - 1)) * 7);
    return { start, end: addDaysUtc(start, 7) };
  });
}

/** Last 6 UTC calendar months, oldest first, including the current month. */
function monthlyBuckets(now: Date): { start: Date; end: Date }[] {
  return Array.from({ length: MONTHLY_TREND_MONTHS }, (_, i) => {
    const monthsAgo = MONTHLY_TREND_MONTHS - 1 - i;
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo + 1, 1));
    return { start, end };
  });
}
