import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiNotFoundResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateAllowedOriginsDto } from './dto/update-allowed-origins.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectsService } from './projects.service';
import { AuditRequestContext, type AuditContext } from '../audit/audit-context.decorator';
import { AuditAction, AuditResource } from '../audit/audit.constants';
import { AuditService } from '../audit/audit.service';

// Dashboard-style management, authenticated by developer session JWT.
// Every lookup here is scoped to the caller's own projects.
@ApiTags('Projects')
@ApiBearerAuth('jwt')
@Controller('v1/projects')
@UseGuards(JwtAuthGuard)
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a project' })
  @ApiResponse({ status: 201, description: 'Project created' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateProjectDto,
    @AuditRequestContext() context: AuditContext,
  ) {
    const project = await this.projectsService.create(user.id, dto);

    await this.audit.record({
      projectId: project.id,
      actor: { id: user.id, email: user.email },
      action: AuditAction.ProjectCreated,
      resourceType: AuditResource.Project,
      resourceId: project.id,
      metadata: { name: project.name },
      context,
    });

    return project;
  }

  @Get()
  @ApiOperation({ summary: "List the authenticated developer's projects" })
  @ApiResponse({ status: 200, description: 'Active projects owned by the caller' })
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.projectsService.findAllForUser(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single project' })
  @ApiResponse({ status: 200, description: 'Project found' })
  @ApiNotFoundResponse({
    description:
      "Project doesn't exist, OR belongs to a different developer — deliberately indistinguishable, to avoid confirming another account's project ID is real.",
  })
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.projectsService.findOneForUser(id, user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a project' })
  @ApiResponse({ status: 200, description: 'Project updated' })
  @ApiNotFoundResponse({ description: 'Not found, or not owned by the caller' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProjectDto,
    @AuditRequestContext() context: AuditContext,
  ) {
    const project = await this.projectsService.update(id, user.id, dto);

    await this.audit.record({
      projectId: id,
      actor: { id: user.id, email: user.email },
      action: AuditAction.ProjectUpdated,
      resourceType: AuditResource.Project,
      resourceId: id,
      // The field names, not the values: a project description is the
      // developer's own text and belongs in the project, not duplicated
      // into a permanent log.
      metadata: { changed: Object.keys(dto) },
      context,
    });

    return project;
  }

  @Patch(':id/allowed-origins')
  @ApiOperation({
    summary: "Replace a project's allowed browser origins",
    description:
      'Controls which browser applications may reach this project\'s SDK surfaces — RTC telemetry, chat REST, ' +
      'and both WebSocket gateways. Send the complete list; it replaces the stored one. ' +
      'An empty list means unconfigured, which allows any origin. ' +
      'Your Raven API key is unaffected and stays server-side either way.',
  })
  @ApiResponse({ status: 200, description: 'Origins replaced' })
  @ApiNotFoundResponse({ description: 'Not found, or not owned by the caller' })
  async updateAllowedOrigins(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAllowedOriginsDto,
    @AuditRequestContext() context: AuditContext,
  ) {
    const project = await this.projectsService.updateAllowedOrigins(id, user.id, dto);

    await this.audit.record({
      projectId: id,
      actor: { id: user.id, email: user.email },
      action: AuditAction.ProjectUpdated,
      resourceType: AuditResource.Project,
      resourceId: id,
      // The origins themselves, unlike a project description, are exactly
      // what an auditor of a security setting needs to see: they are not
      // secret and "who opened us up to what, when" is the question.
      metadata: {
        changed: ['allowedOrigins'],
        allowedOrigins: project.allowedOrigins,
        allowLocalhostOrigins: project.allowLocalhostOrigins,
      },
      context,
    });

    return {
      allowedOrigins: project.allowedOrigins,
      allowLocalhostOrigins: project.allowLocalhostOrigins,
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Archive a project',
    description: 'Soft delete — sets status to ARCHIVED. The project and its history are retained, but it stops appearing in the list.',
  })
  @ApiResponse({ status: 204, description: 'Project archived' })
  @ApiNotFoundResponse({ description: 'Not found, or not owned by the caller' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @AuditRequestContext() context: AuditContext,
  ): Promise<void> {
    await this.projectsService.archive(id, user.id);

    await this.audit.record({
      projectId: id,
      actor: { id: user.id, email: user.email },
      action: AuditAction.ProjectArchived,
      resourceType: AuditResource.Project,
      resourceId: id,
      context,
    });
  }
}
