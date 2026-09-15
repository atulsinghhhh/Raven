import { Controller, Post, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiNotFoundResponse, ApiOperation, ApiResponse, ApiTags, ApiTooManyRequestsResponse } from '@nestjs/swagger';
import { RateLimit } from '../../shared/rate-limit/rate-limit.decorator';
import { RateLimitGuard } from '../../shared/rate-limit/rate-limit.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { Capability } from '../projects/project-permissions';
import { ProjectsService } from '../projects/projects.service';
import { DashboardWsTokenService } from './tokens/dashboard-ws-token.service';

/**
 * Mints a short-lived token for the dashboard realtime WebSocket
 * (DashboardWsGateway, `/v1/dashboard/ws`), using the developer's own
 * session JWT. Same shape as DashboardRtcTokensController: the session
 * JWT never leaves the server (route-helpers.ts's requireSessionToken on
 * the dashboard side reads it from the httpOnly cookie), and this
 * short-lived, project-scoped token is the only credential the browser
 * ever receives.
 *
 * Capability.ProjectRead, not something narrower: every project role
 * already has it (project-permissions.ts), and Phase 5B carries no
 * events yet — the connection itself proves nothing beyond "this user can
 * see this project". Later phases that add project-mutating realtime
 * events can require a stronger capability without changing this
 * endpoint's shape.
 */
@ApiTags('Dashboard — Realtime')
@ApiBearerAuth('jwt')
@Controller('v1/projects/:projectId/dashboard-ws-token')
@UseGuards(JwtAuthGuard)
export class DashboardWsTokensController {
  constructor(
    private readonly tokens: DashboardWsTokenService,
    private readonly projectsService: ProjectsService,
  ) {}

  @Post()
  @UseGuards(RateLimitGuard)
  @RateLimit(30)
  @ApiOperation({
    summary: 'Mint a short-lived token for the dashboard realtime WebSocket',
    description:
      'Requires an authenticated dashboard session and read access to the project. The returned token is scoped to exactly this project via a signed claim — the browser can never choose or widen that scope.',
  })
  @ApiResponse({ status: 201, description: 'Dashboard WS token minted' })
  @ApiNotFoundResponse({ description: 'Project not found, or the caller is not a member' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
  async create(@CurrentUser() user: AuthenticatedUser, @Param('projectId', ParseUUIDPipe) projectId: string) {
    // The one authorization chokepoint (Phase 5A §8): a missing
    // membership or missing capability throws here, before any token is
    // signed. Nothing about project scope in this flow is ever read from
    // a client-supplied value beyond the projectId in the URL, which this
    // call validates.
    await this.projectsService.authorize(projectId, user.id, Capability.ProjectRead);

    return this.tokens.issue({ projectId, userId: user.id });
  }
}
