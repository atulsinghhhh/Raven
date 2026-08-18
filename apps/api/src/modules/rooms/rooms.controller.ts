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
import { ApiBearerAuth, ApiConflictResponse, ApiNotFoundResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentScope } from '../api-keys/decorators/current-scope.decorator';
import { ProjectScope } from '../../shared/environment/environment.constants';
import { ApiKeyAuthGuard } from '../api-keys/guards/api-key-auth.guard';
import { CreateRoomDto } from './dto/create-room.dto';
import { RoomsService } from './rooms.service';

// Rooms are control-plane records only for now — creating one doesn't
// start any WebRTC signaling. Authenticated with a project API key, not a
// developer JWT: this is the endpoint a developer's own backend calls.
@ApiTags('Rooms')
@ApiBearerAuth('apiKey')
@Controller('v1/rooms')
@UseGuards(ApiKeyAuthGuard)
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a room in the API key\'s project' })
  @ApiResponse({ status: 201, description: 'Room created' })
  @ApiConflictResponse({ description: 'A room with this name already exists in this project' })
  create(@CurrentScope() scope: ProjectScope, @Body() dto: CreateRoomDto) {
    return this.roomsService.create(scope, dto);
  }

  @Get()
  @ApiOperation({ summary: "List the API key's project's active rooms" })
  @ApiResponse({ status: 200, description: 'Active rooms' })
  findAll(@CurrentScope() scope: ProjectScope) {
    return this.roomsService.findAllForProject(scope);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single room' })
  @ApiResponse({ status: 200, description: 'Room found' })
  @ApiNotFoundResponse({ description: "Room doesn't exist, or belongs to a different project" })
  findOne(@CurrentScope() scope: ProjectScope, @Param('id', ParseUUIDPipe) id: string) {
    return this.roomsService.findOneForProject(id, scope);
  }

  @Get(':id/participants')
  @ApiOperation({ summary: 'List live participants in a room, from the SFU (Phase 10 server SDK)' })
  @ApiResponse({ status: 200, description: 'Live participants (null if the SFU could not be reached — never a fabricated empty list)' })
  @ApiNotFoundResponse({ description: "Room doesn't exist, or belongs to a different project" })
  async findParticipants(@CurrentScope() scope: ProjectScope, @Param('id', ParseUUIDPipe) id: string) {
    const room = await this.roomsService.findOneForProjectWithLiveState(id, scope);
    return room.liveParticipants;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Close a room', description: 'Soft close — sets status to CLOSED.' })
  @ApiResponse({ status: 204, description: 'Room closed' })
  @ApiNotFoundResponse({ description: "Room doesn't exist, or belongs to a different project" })
  async remove(
    @CurrentScope() scope: ProjectScope,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.roomsService.close(id, scope);
  }
}
