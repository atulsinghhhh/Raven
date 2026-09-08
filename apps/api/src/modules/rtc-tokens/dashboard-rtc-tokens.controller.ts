import { Body, Controller, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiNotFoundResponse, ApiOperation, ApiResponse, ApiTags, ApiTooManyRequestsResponse } from '@nestjs/swagger';
import { RateLimit } from '../../shared/rate-limit/rate-limit.decorator';
import { RateLimitGuard } from '../../shared/rate-limit/rate-limit.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { ProjectsService } from '../projects/projects.service';
import { CreateTestTokenDto } from './dto/create-test-token.dto';
import { RtcTokensService } from './rtc-tokens.service';
import { DEFAULT_ENVIRONMENT } from '../../shared/environment/environment.constants';
import { EnvironmentQueryDto } from '../../shared/environment/environment-query.dto';
import { Capability } from '../projects/project-permissions';

const TEST_TOKEN_TTL_SECONDS = 600; // 10 min — fixed, short, not developer-configurable
const DEFAULT_TEST_IDENTITY = 'dashboard-test-user';

/**
 * Mints a short-lived RTC token straight from the dashboard, using the
 * developer's session JWT instead of a project API key. Only exists so a
 * developer can smoke-test their own room from the dashboard: it's NOT
 * how a real end-user app should get tokens. Those come from the
 * developer's own backend, through the API-key-guarded endpoint in
 * rtc-tokens.controller.ts.
 *
 * Can't just call that endpoint normally either: we only ever store a
 * bcrypt hash of the API key secret, never the raw key, so there's no
 * secret to look up here. Instead we call RtcTokensService directly and
 * authorize by project ownership instead of an API key.
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
    @Query() { environment = DEFAULT_ENVIRONMENT }: EnvironmentQueryDto,
  ) {
    await this.projectsService.authorize(projectId, user.id, Capability.RoomsWrite);

    return this.rtcTokensService.create({ projectId, environment }, roomId, {
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
