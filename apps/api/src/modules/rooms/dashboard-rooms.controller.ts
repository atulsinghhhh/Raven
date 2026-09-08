import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiConflictResponse, ApiNotFoundResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { ProjectsService } from '../projects/projects.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { RoomsService } from './rooms.service';
import { DEFAULT_ENVIRONMENT } from '../../shared/environment/environment.constants';
import { EnvironmentQueryDto } from '../../shared/environment/environment-query.dto';
import { Capability } from '../projects/project-permissions';

/**
 * Dashboard/CLI-facing view of a project's rooms: guarded by developer
 * session JWT, not the ApiKeyAuthGuard that RoomsController uses for a
 * developer's backend. GET routes enrich each room with live participant
 * state read from the room's assigned SFU node, since the Postgres row
 * alone can't say whether anyone's actually connected. The POST route (for `raven rooms create`)
 * reuses the same RoomsService.create() as the API-key-guarded
 * controller: one creation path, two auth entrypoints (human via JWT,
 * backend via API key), not two separate implementations.
 */
@ApiTags('Dashboard — Rooms')
@ApiBearerAuth('jwt')
@Controller('v1/projects/:projectId/rooms')
@UseGuards(JwtAuthGuard)
export class DashboardRoomsController {
  constructor(
    private readonly roomsService: RoomsService,
    private readonly projectsService: ProjectsService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a room in this project' })
  @ApiResponse({ status: 201, description: 'Room created' })
  @ApiConflictResponse({ description: 'A room with this name already exists in this project' })
  @ApiNotFoundResponse({ description: 'Project not found, or not owned by the caller' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateRoomDto,
    @Query() { environment = DEFAULT_ENVIRONMENT }: EnvironmentQueryDto,
  ) {
    await this.projectsService.authorize(projectId, user.id, Capability.RoomsWrite);
    return this.roomsService.create({ projectId, environment }, dto);
  }

  @Get()
  @ApiOperation({ summary: "List a project's rooms with live participant counts" })
  @ApiResponse({ status: 200, description: 'Rooms, each with liveParticipantCount (null if the RTC server is unreachable)' })
  @ApiNotFoundResponse({ description: 'Project not found, or not owned by the caller' })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() { environment = DEFAULT_ENVIRONMENT }: EnvironmentQueryDto,
  ) {
    await this.projectsService.authorize(projectId, user.id, Capability.ProjectRead);
    return this.roomsService.findAllForProjectWithLiveState({ projectId, environment });
  }

  @Get(':roomId')
  @ApiOperation({ summary: 'Get one room with its live participants and published tracks' })
  @ApiResponse({ status: 200, description: 'Room with liveParticipants (null if the RTC server is unreachable)' })
  @ApiNotFoundResponse({ description: 'Project or room not found, or not owned by the caller' })
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Query() { environment = DEFAULT_ENVIRONMENT }: EnvironmentQueryDto,
  ) {
    await this.projectsService.authorize(projectId, user.id, Capability.ProjectRead);
    return this.roomsService.findOneForProjectWithLiveState(roomId, { projectId, environment });
  }
}
