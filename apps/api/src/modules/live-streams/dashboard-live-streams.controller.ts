import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Patch, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { LiveStreamStatus } from '../../generated/prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { ProjectsService } from '../projects/projects.service';
import { Capability } from '../projects/project-permissions';
import { DEFAULT_ENVIRONMENT } from '../../shared/environment/environment.constants';
import { EnvironmentQueryDto } from '../../shared/environment/environment-query.dto';
import { CreateLiveStreamDto } from './dto/create-live-stream.dto';
import { UpdateLiveStreamDto } from './dto/update-live-stream.dto';
import { LiveStreamsService } from './live-streams.service';

/**
 * Dashboard/CLI-facing view of a project's live streams: guarded by
 * developer session JWT, not the ApiKeyAuthGuard that LiveStreamsController
 * uses for a developer's backend. Same reuse discipline as
 * DashboardRoomsController: one LiveStreamsService, two auth entrypoints.
 *
 * Deliberately does NOT expose addHost/removeHost/createViewerToken here;
 * those mint privileged RTC + chat credentials, and this controller is
 * reachable with nothing but a developer's own login session. Minting
 * credentials stays API-key-only, exactly like chat's token issuance never
 * gained a dashboard/CLI equivalent (see registerChatCommand's doc comment
 * in packages/cli).
 */
@ApiTags('Dashboard — Live Streaming')
@ApiBearerAuth('jwt')
@Controller('v1/projects/:projectId/live-streams')
@UseGuards(JwtAuthGuard)
export class DashboardLiveStreamsController {
  constructor(
    private readonly streams: LiveStreamsService,
    private readonly projectsService: ProjectsService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a live stream in this project' })
  @ApiResponse({ status: 201, description: 'Stream created, status CREATED' })
  @ApiNotFoundResponse({ description: 'Project not found, or not owned by the caller' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateLiveStreamDto,
    @Query() { environment = DEFAULT_ENVIRONMENT }: EnvironmentQueryDto,
  ) {
    await this.projectsService.authorize(projectId, user.id, Capability.LiveStreamsWrite);
    return this.streams.create({ projectId, environment }, dto);
  }

  @Get()
  @ApiOperation({ summary: "List a project's live streams" })
  @ApiQuery({ name: 'status', required: false, enum: LiveStreamStatus })
  @ApiResponse({ status: 200, description: 'Streams, most recent first (no live viewer counts — see GET :streamId)' })
  @ApiNotFoundResponse({ description: 'Project not found, or not owned by the caller' })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() { environment = DEFAULT_ENVIRONMENT }: EnvironmentQueryDto,
    @Query('status') status?: LiveStreamStatus,
  ) {
    await this.projectsService.authorize(projectId, user.id, Capability.ProjectRead);
    return this.streams.list({ projectId, environment }, status);
  }

  @Get(':streamId')
  @ApiOperation({ summary: 'Get one stream, including its live viewer count and registered hosts' })
  @ApiResponse({ status: 200, description: 'Stream found' })
  @ApiNotFoundResponse({ description: 'Project or stream not found, or not owned by the caller' })
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('streamId') streamId: string,
    @Query() { environment = DEFAULT_ENVIRONMENT }: EnvironmentQueryDto,
  ) {
    await this.projectsService.authorize(projectId, user.id, Capability.ProjectRead);
    return this.streams.get({ projectId, environment }, streamId);
  }

  @Patch(':streamId')
  @ApiOperation({ summary: "Update a stream's metadata — title, description, thumbnail, visibility, etc." })
  @ApiResponse({ status: 200, description: 'Stream updated' })
  @ApiNotFoundResponse({ description: 'Project or stream not found, or not owned by the caller' })
  @ApiConflictResponse({ description: 'This stream has ended and can no longer be modified' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('streamId') streamId: string,
    @Body() dto: UpdateLiveStreamDto,
    @Query() { environment = DEFAULT_ENVIRONMENT }: EnvironmentQueryDto,
  ) {
    await this.projectsService.authorize(projectId, user.id, Capability.LiveStreamsWrite);
    return this.streams.update({ projectId, environment }, streamId, dto);
  }

  @Post(':streamId/end')
  @ApiOperation({ summary: 'LIVE → ENDED. Terminal — an ended stream cannot be restarted; create a new one.' })
  @ApiResponse({ status: 201, description: 'Stream is now ENDED' })
  @ApiNotFoundResponse({ description: 'Project or stream not found, or not owned by the caller' })
  @ApiConflictResponse({ description: 'Only a LIVE stream can be ended' })
  async end(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('streamId') streamId: string,
    @Query() { environment = DEFAULT_ENVIRONMENT }: EnvironmentQueryDto,
  ) {
    await this.projectsService.authorize(projectId, user.id, Capability.LiveStreamsWrite);
    return this.streams.end({ projectId, environment }, streamId);
  }
}
