import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentProjectId } from '../api-keys/decorators/current-project-id.decorator';
import { ApiKeyAuthGuard } from '../api-keys/guards/api-key-auth.guard';
import { ProjectsService } from '../projects/projects.service';

/**
 * `GET /v1/project` (singular, no ID param) — the API-key equivalent of
 * "which project am I" (Phase 10 server SDK: `raven.projects.get()`). An
 * API key is already permanently scoped to exactly one project by
 * `ApiKeyAuthGuard`, so there is nothing to list/create/update/delete
 * here — those remain human/dashboard-session operations
 * (`ProjectsController`, JWT-guarded). See docs/sdk/server/typescript.md.
 */
@ApiTags('Project')
@ApiBearerAuth('apiKey')
@Controller('v1/project')
@UseGuards(ApiKeyAuthGuard)
export class ApiProjectController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  @ApiOperation({ summary: "Get the API key's own project" })
  @ApiResponse({ status: 200, description: 'The project this API key belongs to' })
  get(@CurrentProjectId() projectId: string) {
    return this.projectsService.findOneById(projectId);
  }
}
