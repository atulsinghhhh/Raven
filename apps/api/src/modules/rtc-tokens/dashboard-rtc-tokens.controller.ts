import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiNotFoundResponse, ApiOperation, ApiResponse, ApiTags, ApiTooManyRequestsResponse } from '@nestjs/swagger';
import { RateLimit } from '../../shared/rate-limit/rate-limit.decorator';
import { RateLimitGuard } from '../../shared/rate-limit/rate-limit.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { ProjectsService } from '../projects/projects.service';
import { CreateTestTokenDto } from './dto/create-test-token.dto';
import { RtcTokensService } from './rtc-tokens.service';

const TEST_TOKEN_TTL_SECONDS = 600; // 10 min — fixed, short, not developer-configurable
const DEFAULT_TEST_IDENTITY = 'dashboard-test-user';

/**
 * Mints a short-lived RTC token from the dashboard itself, authenticated
 * by developer session JWT rather than a project API key. This exists
 * only so a developer can smoke-test their own room from the dashboard
 * (Phase 7 spec §33's E2E flow) — it is deliberately NOT how a real
 * end-user app should get tokens (see docs/sdk.md#authentication and
 * docs/dashboard.md#rtc-tokens): those come from the developer's own
 * backend via the API-key-guarded endpoint in rtc-tokens.controller.ts.
 *
 * A dashboard test token can't reuse a stored API-key secret to call that
 * endpoint the normal way — only a bcrypt hash of the secret is ever
 * stored (never the raw key, even internally), so there is nothing to
 * "look up." Reusing RtcTokensService directly, under project-ownership
 * authorization instead of an API key, is what makes this endpoint
 * possible at all.
 */
@ApiTags('Dashboard — RTC Tokens')
@ApiBearerAuth('jwt')
@Controller('v1/projects/:projectId/rooms/:roomId/test-token')
@UseGuards(JwtAuthGuard)
export class DashboardRtcTokensController {
  constructor(
    private readonly rtcTokensService: RtcTokensService,
    private readonly projectsService: ProjectsService,
  ) {}

  @Post()
  @UseGuards(RateLimitGuard)
  @RateLimit(30)
  @ApiOperation({
    summary: 'Mint a short-lived (10 min) test RTC token for this room, for use from the dashboard only',
    description:
      'Full join/publish/subscribe grant, fixed 10-minute TTL — not developer-configurable. Intended for smoke-testing a room from the dashboard, never for a real end-user app (see docs/dashboard.md#rtc-tokens).',
  })
  @ApiResponse({ status: 201, description: 'Test token minted' })
  @ApiNotFoundResponse({ description: 'Project or room not found, or not owned by the caller' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body() dto: CreateTestTokenDto,
  ) {
    await this.projectsService.findOneForOwner(projectId, user.id);

    return this.rtcTokensService.create(projectId, roomId, {
      participantIdentity: dto.participantIdentity || DEFAULT_TEST_IDENTITY,
      permissions: {
        join: true,
        subscribe: true,
        publish: true,
        publishAudio: true,
        publishVideo: true,
        publishData: false,
      },
      ttlSeconds: TEST_TOKEN_TTL_SECONDS,
    });
  }
}
