import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiNotFoundResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlatformRole } from '../../../generated/prisma/enums';
import { NotFoundError } from '../../../shared/errors/app-error';
import { AuditContext, AuditRequestContext } from '../../audit/audit-context.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AdminAction, AdminTargetType } from '../admin-audit.constants';
import { AdminAuditService } from '../admin-audit.service';
import { CurrentPlatformAdmin } from '../decorators/current-platform-admin.decorator';
import { RequirePlatformRole } from '../decorators/require-platform-role.decorator';
import { AuthenticatedPlatformAdmin, PlatformRoleGuard } from '../guards/platform-role.guard';
import {
  ChatConversationDetail,
  ChatConversationPage,
  ChatOverviewResponse,
  ChatService,
} from './chat.service';
import { QueryChatConversationsDto } from './dto/query-chat-conversations.dto';

/**
 * Chat operations, platform-wide (spec §11) — every project at once,
 * unlike `DashboardChatController`, which a project owner reaches from
 * inside their own project. Same guard pair as every other
 * `/v1/super-admin/*` route: `JwtAuthGuard` first, then `PlatformRoleGuard`,
 * which re-checks the platform role against the database on every request.
 *
 * Same privacy discipline as the dashboard's chat controller carries over
 * unchanged: `Message.content` is never selected, returned, or rendered
 * anywhere on this surface. Only counts, timestamps, sender/member ids,
 * and status.
 */
@ApiTags('Super Admin / Chat')
@ApiBearerAuth('jwt')
@Controller('v1/super-admin/chat')
@UseGuards(JwtAuthGuard, PlatformRoleGuard)
export class SuperAdminChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly adminAudit: AdminAuditService,
  ) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Platform-wide chat metrics',
    description:
      'Conversations, messages, active users, failed messages, throughput, and daily/weekly/monthly message trends. ' +
      'No @RequirePlatformRole: this is an aggregate read, no member identities or per-conversation detail.',
  })
  getOverview(): Promise<ChatOverviewResponse> {
    return this.chat.getOverview();
  }

  @Get('conversations')
  @ApiOperation({
    summary: 'Conversations across every project, paginated',
    description:
      'Project name, member/message counts, last activity, and status per conversation. No member roster and no ' +
      'message-level detail here — that is the permission-restricted GET /conversations/:id below.',
  })
  listConversations(@Query() query: QueryChatConversationsDto): Promise<ChatConversationPage> {
    return this.chat.listConversations(query);
  }

  @Get('conversations/:id')
  @RequirePlatformRole(PlatformRole.SUPER_ADMIN, PlatformRole.ADMIN)
  @ApiOperation({
    summary: 'One conversation — members, counts, timestamps, status. Never message content.',
    description:
      'Restricted to SUPER_ADMIN/ADMIN beyond the aggregate list view above, because this is the one route that names ' +
      'individual member user ids for a specific conversation. Every read is written to AdminAuditLog with the minimum ' +
      'necessary metadata (member/message counts) — never content.',
  })
  @ApiNotFoundResponse({ description: 'Conversation not found' })
  async getConversation(
    @Param('id') id: string,
    @CurrentPlatformAdmin() admin: AuthenticatedPlatformAdmin,
    @AuditRequestContext() context: AuditContext,
  ): Promise<ChatConversationDetail> {
    const conversation = await this.chat.getConversation(id);
    if (!conversation) {
      throw new NotFoundError('Conversation');
    }

    // `admin.conversation_inspected` has no dedicated entry in the shared
    // `AdminAction`/`AdminTargetType` constants (that file is owned by
    // another slice of this build) — both fields are plain string unions,
    // not enums, so a cast here is safe and does not require editing that
    // file. See docs/super-admin/implementation-plan.md §11 for why this
    // route logs at all: it is the "deeper inspection" the spec asks to be
    // explicitly, minimally logged.
    await this.adminAudit.record({
      admin: { id: admin.id, email: admin.email },
      action: 'admin.conversation_inspected' as AdminAction,
      targetType: 'conversation' as AdminTargetType,
      targetId: conversation.id,
      metadata: {
        projectId: conversation.projectId,
        messageCount: conversation.messageCount,
        memberCount: conversation.memberCount,
      },
      context,
    });

    return conversation;
  }
}
