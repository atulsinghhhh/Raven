import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiNotFoundResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { Capability } from '../projects/project-permissions';
import { ProjectsService } from '../projects/projects.service';
import { QueryUsageDto } from './dto/query-usage.dto';
import { UsageAllowanceService } from './usage-allowance.service';

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
  ) {}

  @Get('usage')
  @ApiOperation({ summary: "The caller's Raven minute allowance and how much of it is spent" })
  @ApiResponse({ status: 200, description: 'Included, used and remaining minutes, plus usage percentage' })
  async getUsage(@CurrentUser() user: AuthenticatedUser) {
    return this.allowances.getSummary(user.id);
  }

  @Get('usage/detail')
  @ApiOperation({
    summary: 'The same allowance, plus session history, a daily rollup and a per-project breakdown',
  })
  async getUsageDetail(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryUsageDto) {
    // Sequential rather than concurrent: getSummary provisions the
    // allowance for an account that has never had one, and the three
    // aggregations below read what it wrote.
    const summary = await this.allowances.getSummary(user.id);
    const [history, daily, byProject] = await Promise.all([
      this.allowances.listHistory(user.id, { limit: query.limit }),
      this.allowances.getDailyUsage(user.id, { days: query.days }),
      this.allowances.getUsageByProject(user.id),
    ]);

    return { summary, history, daily, byProject };
  }

  @Get('projects/:projectId/usage')
  @ApiOperation({ summary: "One project's contribution to the owner's allowance" })
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

    // The allowance this project spends is its *owner's*, which for a
    // shared project is not the caller's. So the summary is fetched for the
    // owner while the history is filtered to that same owner's sessions in
    // this project — a member reading this page sees the meter their work
    // actually draws down, not their own untouched allowance.
    const summary = await this.allowances.getSummary(project.ownerId);
    const [history, daily] = await Promise.all([
      this.allowances.listHistory(project.ownerId, { projectId, limit: query.limit }),
      this.allowances.getDailyUsage(project.ownerId, { projectId, days: query.days }),
    ]);

    return {
      /** True when the caller is reading someone else's allowance. */
      ownedByCaller: project.ownerId === user.id,
      summary,
      history,
      daily,
    };
  }
}
