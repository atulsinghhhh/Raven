import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiNotFoundResponse, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { ProjectsService } from '../projects/projects.service';
import { ConnectionsService } from './connections.service';
import { DiagnosticsService } from './diagnostics.service';
import { QueryConnectionsDto } from './dto/query-connections.dto';
import { QueryErrorsDto } from './dto/query-errors.dto';
import { ErrorsService } from './errors.service';
import { MetricsService } from './metrics.service';

/**
 * Developer-facing observability — connections, errors, metrics,
 * diagnostics (Phase 9 spec §34). JWT-guarded and ownership-checked like
 * every other Dashboard/CLI-facing controller in this API; the same
 * `RavenApiClient`/`ravenApi` pattern used everywhere else, no separate
 * observability-only auth model.
 */
@ApiTags('Dashboard — Observability')
@ApiBearerAuth('jwt')
@Controller('v1/projects/:projectId')
@UseGuards(JwtAuthGuard)
export class DashboardObservabilityController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly connectionsService: ConnectionsService,
    private readonly errorsService: ErrorsService,
    private readonly metricsService: MetricsService,
    private readonly diagnosticsService: DiagnosticsService,
  ) {}

  @Get('connections')
  @ApiOperation({ summary: "List a project's real RTC connections" })
  @ApiNotFoundResponse({ description: 'Project not found, or not owned by the caller' })
  async listConnections(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: QueryConnectionsDto,
  ) {
    await this.projectsService.findOneForOwner(projectId, user.id);
    return this.connectionsService.listForProject(projectId, query);
  }

  @Get('connections/:connectionId')
  @ApiOperation({ summary: 'Get one connection with its full event timeline and any errors' })
  @ApiNotFoundResponse({ description: 'Project or connection not found' })
  async getConnection(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('connectionId') connectionId: string,
  ) {
    await this.projectsService.findOneForOwner(projectId, user.id);
    return this.connectionsService.getDetail(projectId, connectionId);
  }

  @Get('errors')
  @ApiOperation({ summary: "List a project's classified errors" })
  @ApiNotFoundResponse({ description: 'Project not found, or not owned by the caller' })
  async listErrors(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: QueryErrorsDto,
  ) {
    await this.projectsService.findOneForOwner(projectId, user.id);
    return this.errorsService.listForProject(projectId, query);
  }

  @Get('errors/:errorId')
  @ApiOperation({ summary: 'Get one classified error, with its connection if any' })
  @ApiNotFoundResponse({ description: 'Project or error not found' })
  async getError(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('errorId') errorId: string,
  ) {
    await this.projectsService.findOneForOwner(projectId, user.id);
    return this.errorsService.getDetail(projectId, errorId);
  }

  @Get('metrics')
  @ApiOperation({ summary: 'Real aggregate connection/error metrics for this project' })
  @ApiQuery({ name: 'range', required: false, enum: ['15m', '1h', '24h', '7d'] })
  @ApiNotFoundResponse({ description: 'Project not found, or not owned by the caller' })
  async getMetrics(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('range') range?: string,
  ) {
    await this.projectsService.findOneForOwner(projectId, user.id);
    return this.metricsService.getOverview(projectId, range);
  }

  @Get('diagnostics')
  @ApiOperation({ summary: 'Authenticated per-dependency diagnostics for this project' })
  @ApiResponse({ status: 200, description: 'API/auth/signaling/SFU/TURN status plus active connection count' })
  @ApiNotFoundResponse({ description: 'Project not found, or not owned by the caller' })
  async getDiagnostics(@CurrentUser() user: AuthenticatedUser, @Param('projectId', ParseUUIDPipe) projectId: string) {
    const project = await this.projectsService.findOneForOwner(projectId, user.id);
    return this.diagnosticsService.getDiagnostics(project);
  }
}
