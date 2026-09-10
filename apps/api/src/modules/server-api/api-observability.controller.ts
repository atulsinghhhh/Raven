import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentProjectId } from '../api-keys/decorators/current-project-id.decorator';
import { ApiKeyAuthGuard } from '../api-keys/guards/api-key-auth.guard';
import { ConnectionsService } from '../observability/connections.service';
import { DiagnosticsService } from '../observability/diagnostics.service';
import { QueryConnectionsDto } from '../observability/dto/query-connections.dto';
import { QueryErrorsDto } from '../observability/dto/query-errors.dto';
import { ErrorsService } from '../observability/errors.service';
import { MetricsService } from '../observability/metrics.service';
import { ProjectsService } from '../projects/projects.service';

/**
 * The API-key-guarded twin of `DashboardObservabilityController`: same
 * Phase 9 services, same data, different entrypoint (a backend/server
 * SDK authenticates with a permanent project API key, never a human JWT
 * session, so it can't call `/v1/projects/:projectId/...`). No
 * `:projectId` in the path here: it's derived from the key itself, the
 * same way `RoomsController`/`RtcTokensController` already work. See
 * docs/sdk/server/typescript.md and docs/sdk/server/python.md.
 */
@ApiTags('Server SDK — Observability')
@ApiBearerAuth('apiKey')
@Controller('v1')
@UseGuards(ApiKeyAuthGuard)
export class ApiObservabilityController {
  constructor(
    private readonly connectionsService: ConnectionsService,
    private readonly errorsService: ErrorsService,
    private readonly metricsService: MetricsService,
    private readonly diagnosticsService: DiagnosticsService,
    private readonly projectsService: ProjectsService,
  ) {}

  @Get('connections')
  @ApiOperation({ summary: "List the API key's project's real RTC connections" })
  listConnections(@CurrentProjectId() projectId: string, @Query() query: QueryConnectionsDto) {
    return this.connectionsService.listForProject(projectId, query);
  }

  @Get('connections/:connectionId')
  @ApiOperation({ summary: 'Get one connection with its full event timeline and any errors' })
  @ApiResponse({ status: 200, description: 'Connection detail' })
  getConnection(@CurrentProjectId() projectId: string, @Param('connectionId') connectionId: string) {
    return this.connectionsService.getDetail(projectId, connectionId);
  }

  @Get('errors')
  @ApiOperation({ summary: "List the API key's project's classified errors" })
  listErrors(@CurrentProjectId() projectId: string, @Query() query: QueryErrorsDto) {
    return this.errorsService.listForProject(projectId, query);
  }

  @Get('errors/:errorId')
  @ApiOperation({ summary: 'Get one classified error, with its connection if any' })
  getError(@CurrentProjectId() projectId: string, @Param('errorId') errorId: string) {
    return this.errorsService.getDetail(projectId, errorId);
  }

  @Get('metrics')
  @ApiOperation({ summary: "Real aggregate connection/error metrics for the API key's project" })
  @ApiQuery({ name: 'range', required: false, enum: ['15m', '1h', '24h', '7d'] })
  getMetrics(@CurrentProjectId() projectId: string, @Query('range') range?: string) {
    return this.metricsService.getOverview(projectId, range);
  }

  @Get('diagnostics')
  @ApiOperation({ summary: "Authenticated per-dependency diagnostics for the API key's project" })
  async getDiagnostics(@CurrentProjectId() projectId: string) {
    const project = await this.projectsService.findOneById(projectId);
    return this.diagnosticsService.getDiagnostics(project);
  }
}
