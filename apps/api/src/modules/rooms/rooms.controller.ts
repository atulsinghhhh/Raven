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
import { CurrentProjectId } from '../api-keys/decorators/current-project-id.decorator';
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
  create(@CurrentProjectId() projectId: string, @Body() dto: CreateRoomDto) {
    return this.roomsService.create(projectId, dto);
  }

  @Get()
  @ApiOperation({ summary: "List the API key's project's active rooms" })
  @ApiResponse({ status: 200, description: 'Active rooms' })
  findAll(@CurrentProjectId() projectId: string) {
    return this.roomsService.findAllForProject(projectId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single room' })
  @ApiResponse({ status: 200, description: 'Room found' })
  @ApiNotFoundResponse({ description: "Room doesn't exist, or belongs to a different project" })
  findOne(@CurrentProjectId() projectId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.roomsService.findOneForProject(id, projectId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Close a room', description: 'Soft close — sets status to CLOSED.' })
  @ApiResponse({ status: 204, description: 'Room closed' })
  @ApiNotFoundResponse({ description: "Room doesn't exist, or belongs to a different project" })
  async remove(
    @CurrentProjectId() projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.roomsService.close(id, projectId);
  }
}
