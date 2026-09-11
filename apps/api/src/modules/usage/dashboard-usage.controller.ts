import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiNotFoundResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { LiveStreamStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { Capability } from '../projects/project-permissions';
import { ProjectsService } from '../projects/projects.service';
import { QueryUsageDto } from './dto/query-usage.dto';
import { UsageAllowanceService } from './usage-allowance.service';

/** The `chat` block every usage response gets alongside its RTC figures. */
export interface ChatUsageBlock {
  used: number;
  limit: number;
  unit: 'messages';
}

/**
 * The `liveStreaming` block every usage response gets. `hostHours*` is the
 * metered allowance (host/co-host connected time — viewers are never
 * counted); the rest are the free-tier product limits, static configuration
 * rather than consumption, except `concurrentStreams` which is a live count.
 */
export interface LiveStreamingUsageBlock {
  hostHoursUsed: number;
  hostHoursLimit: number;
  concurrentStreams: number;
  maxConcurrentStreams: number;
  maxViewers: number;
  maxStreamDurationMinutes: number;
}

/**
 * The developer's own usage: their included minutes, what they have spent,
 * and the sessions that spent it.
 *
 * Account-scoped, not project-scoped, because the allowance is. That is
 * also why there is no `projectId` on the first two routes and no
 * capability check on them: a developer is always allowed to read their own
 * meter. The project-scoped route below is the one that needs authorizing,
 * and it authorizes exactly like every other project route in the API.
 *
 * Read-only by design. Nothing here can grant, adjust, reset or transfer an
 * allowance — those are Admin Portal operations and the Admin Portal does
 * not exist yet, so neither do the endpoints.
 */
@ApiTags('Dashboard — Usage')
@ApiBearerAuth('jwt')
@Controller('v1')
@UseGuards(JwtAuthGuard)
export class DashboardUsageController {
  constructor(
    private readonly allowances: UsageAllowanceService,
    private readonly projectsService: ProjectsService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  @Get('usage')
  @ApiOperation({ summary: "The caller's RTC, Chat and Live Streaming allowances, and how much of each is spent" })
  @ApiResponse({
    status: 200,
    description:
      'The RTC figures flat at the top level (unchanged — included/used/remaining minutes, usage percentage), ' +
      'plus sibling `chat` and `liveStreaming` blocks for the other two independent free-tier pools.',
  })
  async getUsage(@CurrentUser() user: AuthenticatedUser) {
    const [summary, chat, liveStreaming] = await Promise.all([
      this.allowances.getSummary(user.id),
      this.chatBlock(user.id),
      this.liveStreamingBlock(user.id),
    ]);
    return { ...summary, chat, liveStreaming };
  }

  @Get('usage/detail')
  @ApiOperation({
    summary:
      'The same three allowances, plus RTC session history, a daily rollup and a per-project breakdown. ' +
      'Chat and Live Streaming get summary figures only in this phase — no history breakdown yet.',
  })
  async getUsageDetail(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryUsageDto) {
    // Sequential rather than concurrent: getSummary provisions the RTC
    // allowance for an account that has never had one, and the three RTC
    // aggregations below read what it wrote. chat/liveStreaming provision
    // (and read) their own independent allowances, so they run alongside
    // everything else rather than waiting on RTC's provisioning.
    const summary = await this.allowances.getSummary(user.id);
    const [history, daily, byProject, chat, liveStreaming] = await Promise.all([
      this.allowances.listHistory(user.id, { limit: query.limit }),
      this.allowances.getDailyUsage(user.id, { days: query.days }),
      this.allowances.getUsageByProject(user.id),
      this.chatBlock(user.id),
      this.liveStreamingBlock(user.id),
    ]);

    return { summary, history, daily, byProject, chat, liveStreaming };
  }

  @Get('projects/:projectId/usage')
  @ApiOperation({ summary: "One project's contribution to its owner's RTC, Chat and Live Streaming allowances" })
  @ApiNotFoundResponse({ description: 'Project not found, or not visible to the caller' })
  async getProjectUsage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: QueryUsageDto,
  ) {
    // `usage:read`, not `project:read`. The capability has existed since the
    // role matrix was written (project-permissions.ts) and this is the first
    // route to need it — which is the point of the BILLING role, whose whole
    // grant is "read the project and read its usage, nothing else".
    const { project } = await this.projectsService.authorize(projectId, user.id, Capability.UsageRead);

    // The allowances this project spends are its *owner's*, which for a
    // shared project is not the caller's. So every figure below is fetched
    // for the owner (RTC history filtered to this project) — a member
    // reading this page sees the meters their work actually draws down,
    // not their own untouched allowances. Chat and Live Streaming are
    // account-wide by design (same attribution as RTC), so their figures
    // here are the owner's whole-account totals, not filtered to this
    // project specifically — there is no per-project breakdown for them
    // yet, same limitation as the account-level route above.
    const summary = await this.allowances.getSummary(project.ownerId);
    const [history, daily, chat, liveStreaming] = await Promise.all([
      this.allowances.listHistory(project.ownerId, { projectId, limit: query.limit }),
      this.allowances.getDailyUsage(project.ownerId, { projectId, days: query.days }),
      this.chatBlock(project.ownerId),
      this.liveStreamingBlock(project.ownerId),
    ]);

    return {
      /** True when the caller is reading someone else's allowance. */
      ownedByCaller: project.ownerId === user.id,
      summary,
      history,
      daily,
      chat,
      liveStreaming,
    };
  }

  private async chatBlock(userId: string): Promise<ChatUsageBlock> {
    const chat = await this.allowances.getChatSummary(userId);
    return { used: chat.usedMessages, limit: chat.includedMessages, unit: 'messages' };
  }

  private async liveStreamingBlock(userId: string): Promise<LiveStreamingUsageBlock> {
    const [live, concurrentStreams] = await Promise.all([
      this.allowances.getLiveStreamingSummary(userId),
      // Account-wide, matching the concurrency cap itself (LiveStream.ownerId,
      // enforced by a partial unique index — see LiveStreamsService.start).
      this.prisma.liveStream.count({ where: { ownerId: userId, status: LiveStreamStatus.LIVE } }),
    ]);

    return {
      hostHoursUsed: live.usedHostHours,
      hostHoursLimit: live.includedHostHours,
      concurrentStreams,
      maxConcurrentStreams: this.configService.get<number>('usage.live.maxConcurrentStreams')!,
      maxViewers: this.configService.get<number>('usage.live.maxViewers')!,
      maxStreamDurationMinutes: this.configService.get<number>('usage.live.maxStreamDurationMinutes')!,
    };
  }
}
