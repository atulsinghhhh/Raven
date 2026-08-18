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
 * session JWT (not ApiKeyAuthGuard, which apps/api's own `RoomsController`
 * uses for a developer's *backend* to call). GET routes enrich each room
 * with live LiveKit participant state, since the Postgres Room row alone
 * can't say whether anyone is actually connected right now (Phase 7 spec
 * §6/§12 — no fake metrics). The POST route (added in Phase 8, for
 * `raven rooms create`) reuses the exact same RoomsService.create() the
 * API-key-guarded controller calls — one creation path, two auth
 * entrypoints for the two different callers (a human via JWT, a
 * developer's backend via API key), not two separate implementations.
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
