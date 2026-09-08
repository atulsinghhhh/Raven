import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiNotFoundResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ConnectionState, ConversationStatus } from '../../../generated/prisma/client';
import { PrismaService } from '../../../shared/database/prisma.service';
import { NotFoundError } from '../../../shared/errors/app-error';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../../auth/jwt-payload.interface';
import { ProjectsService } from '../../projects/projects.service';
import { ChatGateway } from '../gateway/chat.gateway';
import { ChatMetricsService } from '../metrics/chat-metrics.service';
import { PresenceService } from '../presence/presence.service';
import { Capability } from '../../projects/project-permissions';

const RANGE_MINUTES: Record<string, number> = { '15m': 15, '1h': 60, '24h': 1440 };

/**
 * Dashboard-facing chat views. JWT-guarded and ownership-checked like
 * every other developer-facing controller here: the same shape as
 * DashboardObservabilityController, not a separate auth model.
 *
 * Message *contents* are on purpose absent from this surface. The
 * dashboard shows metadata: counts, connections, rooms, error rates.
 * Reading a customer's messages is not a thing a Raven operator or a
 * project owner should be able to do casually from a metrics page
 * (spec §50).
 */
@ApiTags('Dashboard — Chat')
@ApiBearerAuth('jwt')
@Controller('v1/projects/:projectId/chat')
@UseGuards(JwtAuthGuard)
export class DashboardChatController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
    private readonly metrics: ChatMetricsService,
    private readonly presence: PresenceService,
    private readonly gateway: ChatGateway,
  ) {}

  @Get('overview')
  @ApiOperation({ summary: 'Chat activity for this project — real counters, never estimates' })
  @ApiQuery({ name: 'range', required: false, enum: Object.keys(RANGE_MINUTES) })
  @ApiNotFoundResponse({ description: 'Project not found, or not owned by the caller' })
  async overview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('range') range = '1h',
  ) {
    await this.projectsService.authorize(projectId, user.id, Capability.ChatRead);
    const minutes = RANGE_MINUTES[range] ?? RANGE_MINUTES['1h'];

    const [
      conversations,
      messages,
      activeConnections,
      messagesSent,
      messagesFailed,
      messagesFannedOut,
      connectionsOpened,
      connectionsFailed,
      rateLimited,
      persistLatencyMs,
      fanoutLatencyMs,
      endToEndLatencyMs,
    ] = await Promise.all([
      this.prisma.conversation.count({ where: { projectId, status: ConversationStatus.ACTIVE } }),
      this.prisma.message.count({
        where: { projectId, deletedAt: null, createdAt: { gte: new Date(Date.now() - minutes * 60_000) } },
      }),
      this.prisma.chatConnection.count({ where: { projectId, state: ConnectionState.CONNECTED } }),
      this.metrics.readCounter(projectId, 'messages_sent', minutes),
      this.metrics.readCounter(projectId, 'messages_failed', minutes),
      this.metrics.readCounter(projectId, 'messages_fanned_out', minutes),
      this.metrics.readCounter(projectId, 'connections_opened', minutes),
      this.metrics.readCounter(projectId, 'connections_failed', minutes),
      this.metrics.readCounter(projectId, 'rate_limited', minutes),
      this.metrics.readAverageLatency(projectId, 'persist', minutes),
      this.metrics.readAverageLatency(projectId, 'fanout', minutes),
      this.metrics.readAverageLatency(projectId, 'end_to_end', minutes),
    ]);

    return {
      range,
      conversations,
      messagesStored: messages,
      activeConnections,
      messagesSent,
      messagesFailed,
      messagesFannedOut,
      connectionsOpened,
      connectionsFailed,
      rateLimited,
      messagesPerSecond: round2(messagesSent / (minutes * 60)),
      latency: {
        // null = nothing measured in this window. Never a fabricated
        // number for a quiet project.
        persistMs: persistLatencyMs,
        fanoutMs: fanoutLatencyMs,
        // Wall-clock across two machines, so only as trustworthy as the
        // client's clock. Labelled here rather than presented as ground truth.
        endToEndMs: endToEndLatencyMs,
      },
      gateway: this.gateway.getMetrics(),
    };
  }

  @Get('conversations')
  @ApiOperation({ summary: 'Conversations with message counts and last activity' })
  async listConversations(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    await this.projectsService.authorize(projectId, user.id, Capability.ChatRead);

    const conversations = await this.prisma.conversation.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        _count: { select: { messages: true, members: true } },
        messages: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
          // Timestamp and sender only: the dashboard shows activity, not content.
          select: { createdAt: true, senderId: true },
        },
      },
    });

    return conversations.map((conversation) => ({
      id: conversation.publicId,
      name: conversation.name,
      type: conversation.type,
      status: conversation.status,
      roomId: conversation.roomId,
      retentionDays: conversation.retentionDays,
      messageCount: conversation._count.messages,
      memberCount: conversation._count.members,
      lastMessageAt: conversation.messages[0]?.createdAt ?? null,
      lastMessageSenderId: conversation.messages[0]?.senderId ?? null,
      createdAt: conversation.createdAt,
    }));
  }

  @Get('conversations/:conversationId')
  @ApiOperation({ summary: 'One conversation — metadata only, no message content' })
  @ApiNotFoundResponse({ description: 'Conversation not found in this project' })
  async getConversation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('conversationId') conversationPublicId: string,
  ) {
    await this.projectsService.authorize(projectId, user.id, Capability.ChatRead);

    // findFirst instead of resolveConversation()'s findUnique: this is
    // the one caller that also needs `include`, and Prisma's generated
    // types don't let a shared helper accept an arbitrary include and
    // still return a precisely-typed result.
    const conversation = await this.prisma.conversation.findFirst({
      where: { publicId: conversationPublicId, projectId },
      include: {
        _count: { select: { messages: true, members: true } },
        messages: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true, senderId: true },
        },
      },
    });
    if (!conversation) {
      throw new NotFoundError('Conversation');
    }

    return {
      id: conversation.publicId,
      name: conversation.name,
      type: conversation.type,
      status: conversation.status,
      roomId: conversation.roomId,
      retentionDays: conversation.retentionDays,
      metadata: conversation.metadata,
      messageCount: conversation._count.messages,
      memberCount: conversation._count.members,
      lastMessageAt: conversation.messages[0]?.createdAt ?? null,
      lastMessageSenderId: conversation.messages[0]?.senderId ?? null,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    };
  }

  @Get('conversations/:conversationId/members')
  @ApiOperation({ summary: 'Members of one conversation' })
  @ApiNotFoundResponse({ description: 'Conversation not found in this project' })
  async listConversationMembers(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('conversationId') conversationPublicId: string,
  ) {
    await this.projectsService.authorize(projectId, user.id, Capability.ChatRead);
    const conversation = await this.resolveConversation(projectId, conversationPublicId);

    const members = await this.prisma.chatMember.findMany({
      where: { conversationId: conversation.id },
      orderBy: { joinedAt: 'asc' },
      take: 500,
    });

    return members.map((member) => ({
      userId: member.userId,
      role: member.role,
      status: member.status,
      joinedAt: member.joinedAt,
      leftAt: member.leftAt,
    }));
  }

  @Get('conversations/:conversationId/messages')
  @ApiOperation({
    summary: 'Message metadata for one conversation — id, sender, timing, status. Never content.',
  })
  @ApiQuery({ name: 'senderId', required: false })
  @ApiQuery({ name: 'before', required: false, description: 'ISO timestamp — only messages sent before this' })
  @ApiQuery({ name: 'after', required: false, description: 'ISO timestamp — only messages sent after this' })
  @ApiQuery({ name: 'limit', required: false })
  @ApiNotFoundResponse({ description: 'Conversation not found in this project' })
  async listConversationMessages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('conversationId') conversationPublicId: string,
    @Query('senderId') senderId?: string,
    @Query('before') before?: string,
    @Query('after') after?: string,
    @Query('limit') limit?: string,
  ) {
    await this.projectsService.authorize(projectId, user.id, Capability.ChatRead);
    const conversation = await this.resolveConversation(projectId, conversationPublicId);

    const beforeDate = parseDateOrUndefined(before);
    const afterDate = parseDateOrUndefined(after);

    const messages = await this.prisma.message.findMany({
      where: {
        conversationId: conversation.id,
        ...(senderId ? { senderId } : {}),
        ...(beforeDate || afterDate
          ? { createdAt: { ...(beforeDate ? { lt: beforeDate } : {}), ...(afterDate ? { gt: afterDate } : {}) } }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(limit) || 50, 200),
      // Metadata only (spec §50): `content` is never selected here, so a
      // future field added to this query can't accidentally leak it the
      // way a `...spread` of the whole row would.
      select: {
        publicId: true,
        senderId: true,
        type: true,
        replyToMessageId: true,
        threadRootId: true,
        editedAt: true,
        deletedAt: true,
        deletedBy: true,
        createdAt: true,
        _count: { select: { reactions: true, attachments: true } },
      },
    });

    return messages.map((message) => ({
      id: message.publicId,
      senderId: message.senderId,
      type: message.type,
      status: message.deletedAt ? 'deleted' : message.editedAt ? 'edited' : 'sent',
      replyToMessageId: message.replyToMessageId,
      threadRootId: message.threadRootId,
      reactionCount: message._count.reactions,
      attachmentCount: message._count.attachments,
      createdAt: message.createdAt,
      editedAt: message.editedAt,
      deletedAt: message.deletedAt,
    }));
  }

  @Get('connections')
  @ApiOperation({ summary: 'Chat WebSocket sessions, newest first' })
  async listConnections(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('state') state?: string,
    @Query('limit') limit?: string,
  ) {
    await this.projectsService.authorize(projectId, user.id, Capability.ChatRead);
    return this.prisma.chatConnection.findMany({
      where: {
        projectId,
        ...(state && state in ConnectionState ? { state: state as ConnectionState } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(limit) || 50, 200),
    });
  }

  @Get('conversations/:conversationId/presence')
  @ApiOperation({ summary: 'Who is present in one conversation right now (read from Redis, not Postgres)' })
  async presenceFor(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('conversationId') conversationPublicId: string,
  ) {
    await this.projectsService.authorize(projectId, user.id, Capability.ChatRead);
    const conversation = await this.prisma.conversation.findUnique({
      where: { publicId: conversationPublicId },
      select: { id: true, projectId: true },
    });
    if (!conversation || conversation.projectId !== projectId) {
      return [];
    }
    return this.presence.list(projectId, conversation.id);
  }

  /**
   * Looks up a conversation by its public id and checks it belongs to
   * this project: the same not-found-if-cross-project pattern
   * `presenceFor` already uses, shared here so the three new endpoints
   * above don't each re-derive it slightly differently.
   */
  private async resolveConversation(projectId: string, conversationPublicId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { publicId: conversationPublicId },
    });
    if (!conversation || conversation.projectId !== projectId) {
      throw new NotFoundError('Conversation');
    }
    return conversation;
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function parseDateOrUndefined(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
