import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiNotFoundResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { Capability } from '../projects/project-permissions';
import { ProjectsService } from '../projects/projects.service';
import { SelectIntegrationDto } from './dto/select-integration.dto';
import { IntegrationsService, parseProductParam } from './integrations.service';

/**
 * Backs the quickstart page's integration wizard. `ProjectRead` gates every
 * route here — same as the rest of the wizard, this only ever reads
 * non-sensitive project state and records a developer's own stack choice;
 * it never touches keys or secrets.
 */
@ApiTags('Dashboard — Integrations')
@ApiBearerAuth('jwt')
@Controller('v1/projects/:projectId/integrations')
@UseGuards(JwtAuthGuard)
export class IntegrationsController {
  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly projectsService: ProjectsService,
  ) {}

  @Get()
  @ApiOperation({ summary: "A project's saved integration selections, one per product" })
  @ApiNotFoundResponse({ description: 'Project not found, or not owned by the caller' })
  async getAll(@CurrentUser() user: AuthenticatedUser, @Param('projectId', ParseUUIDPipe) projectId: string) {
    await this.projectsService.authorize(projectId, user.id, Capability.ProjectRead);
    return this.integrationsService.getAll(projectId);
  }

  @Patch(':product')
  @ApiOperation({ summary: 'Save the chosen language/framework for a product' })
  @ApiNotFoundResponse({ description: 'Project not found, or not owned by the caller' })
  async select(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('product') productParam: string,
    @Body() dto: SelectIntegrationDto,
  ) {
    const { project } = await this.projectsService.authorize(projectId, user.id, Capability.ProjectRead);
    return this.integrationsService.select(project, user.id, parseProductParam(productParam), dto);
  }

  @Post(':product/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Run a real, server-side check of this project's readiness for a product" })
  @ApiResponse({ status: 200, description: 'Pass/fail per dependency, never a self-reported status' })
  @ApiNotFoundResponse({ description: 'Project not found, or not owned by the caller' })
  async verify(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('product') productParam: string,
  ) {
    const { project } = await this.projectsService.authorize(projectId, user.id, Capability.ProjectRead);
    return this.integrationsService.verify(project, user.id, parseProductParam(productParam));
  }
}
