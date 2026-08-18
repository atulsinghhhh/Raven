import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiConflictResponse, ApiNotFoundResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { ProjectsService } from '../projects/projects.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { RoomsService } from './rooms.service';

/**
 * Dashboard/CLI-facing view of a project's rooms — guarded by developer
 * session JWT, not the ApiKeyAuthGuard that RoomsController uses for a
 * developer's backend. GET routes enrich each room with live LiveKit
 * participant state, since the Postgres row alone can't say whether
 * anyone's actually connected. The POST route (for `raven rooms create`)
 * reuses the same RoomsService.create() as the API-key-guarded
 * controller — one creation path, two auth entrypoints (human via JWT,
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
  ) {
    await this.projectsService.findOneForOwner(projectId, user.id);
    return this.roomsService.create(projectId, dto);
  }

  @Get()
  @ApiOperation({ summary: "List a project's rooms with live participant counts" })
  @ApiResponse({ status: 200, description: 'Rooms, each with liveParticipantCount (null if LiveKit is unreachable)' })
  @ApiNotFoundResponse({ description: 'Project not found, or not owned by the caller' })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    await this.projectsService.findOneForOwner(projectId, user.id);
    return this.roomsService.findAllForProjectWithLiveState(projectId);
  }

  @Get(':roomId')
  @ApiOperation({ summary: 'Get one room with its live participants and published tracks' })
  @ApiResponse({ status: 200, description: 'Room with liveParticipants (null if LiveKit is unreachable)' })
  @ApiNotFoundResponse({ description: 'Project or room not found, or not owned by the caller' })
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('roomId', ParseUUIDPipe) roomId: string,
  ) {
    await this.projectsService.findOneForOwner(projectId, user.id);
    return this.roomsService.findOneForProjectWithLiveState(roomId, projectId);
  }
}
