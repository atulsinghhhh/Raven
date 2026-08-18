import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { Capability } from '../projects/project-permissions';
import { ProjectsService } from '../projects/projects.service';
import { AuditService } from './audit.service';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto';

@ApiTags('Audit')
@ApiBearerAuth('jwt')
@Controller('v1/projects/:projectId/audit-logs')
@UseGuards(JwtAuthGuard)
export class AuditController {
  constructor(
    private readonly audit: AuditService,
    private readonly projects: ProjectsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Administrative actions taken on this project, newest first',
    description:
      'Read-only by design: there is no endpoint that can change or remove an entry, because an audit log an administrator can edit is not an audit log. Requires audit:read, which owners and admins hold.',
  })
  @ApiForbiddenResponse({ description: 'Your role does not allow reading the audit log' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: QueryAuditLogsDto,
  ) {
    await this.projects.authorize(projectId, user.id, Capability.AuditRead);
    return this.audit.list(projectId, query);
  }
}
