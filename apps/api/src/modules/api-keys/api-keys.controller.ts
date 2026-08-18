import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { RateLimit } from '../../shared/rate-limit/rate-limit.decorator';
import { RateLimitGuard } from '../../shared/rate-limit/rate-limit.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { ProjectsService } from '../projects/projects.service';
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';

// Management endpoints for a project's API keys — guarded by
// JwtAuthGuard, so the developer has to be logged in and own the project.
// Not to be confused with ApiKeyAuthGuard, which authenticates *with* one
// of these keys over on Rooms/RTC Tokens.
@ApiTags('API Keys')
@ApiBearerAuth('jwt')
@Controller('v1/projects/:projectId/api-keys')
@UseGuards(JwtAuthGuard)
export class ApiKeysController {
  constructor(
    private readonly apiKeysService: ApiKeysService,
    private readonly projectsService: ProjectsService,
  ) {}

  @Post()
  @UseGuards(RateLimitGuard)
  @RateLimit(20)
  @ApiOperation({
    summary: 'Create a project API key',
    description:
      'The full key (publicId.secret) is returned ONLY in this response — it is never recoverable afterward, since only a bcrypt hash of it is stored. Rate limited to 20 requests/window/IP.',
  })
  @ApiResponse({
    status: 201,
    description: 'Key created — copy the `key` field now, it will not be shown again',
    schema: {
      example: {
        id: '15633d21-c086-4d30-b326-cc75518cf369',
        name: 'production-server',
        publicId: 'rvk_TugSAioScTjb',
        key: 'rvk_TugSAioScTjb.roU60yZAdaa72T2tov2Mzf9E8aQ1gJL1gvdAESyMabA',
        createdAt: '2026-08-17T15:09:48.859Z',
        warning: 'This is the only time the full key is shown. Store it securely — it cannot be retrieved again.',
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Project not found, or not owned by the caller' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateApiKeyDto,
  ) {
    await this.projectsService.findOneForOwner(projectId, user.id);
    const created = await this.apiKeysService.create(projectId, dto);

    return {
      ...created,
      warning:
        'This is the only time the full key is shown. Store it securely — it cannot be retrieved again.',
    };
  }

  @Get()
  @ApiOperation({
    summary: "List a project's API keys",
    description: 'Never includes the secret or its hash — only publicId, name, status, and timestamps.',
  })
  @ApiResponse({ status: 200, description: 'Keys for this project (secrets never included)' })
  @ApiNotFoundResponse({ description: 'Project not found, or not owned by the caller' })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    await this.projectsService.findOneForOwner(projectId, user.id);
    return this.apiKeysService.findAllForProject(projectId);
  }

  @Delete(':keyId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Revoke an API key',
    description: 'Immediate and permanent — a revoked key can never authenticate again.',
  })
  @ApiResponse({ status: 204, description: 'Key revoked' })
  @ApiNotFoundResponse({ description: 'Project or key not found, or not owned by the caller' })
  async revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('keyId', ParseUUIDPipe) keyId: string,
  ): Promise<void> {
    await this.projectsService.findOneForOwner(projectId, user.id);
    await this.apiKeysService.revoke(projectId, keyId);
  }
}
