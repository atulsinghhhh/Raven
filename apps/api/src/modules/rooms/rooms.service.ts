import { Injectable } from '@nestjs/common';
import { Room, RoomStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { ConflictError, NotFoundError } from '../../shared/errors/app-error';
import { RavenErrorCode } from '../../shared/errors/error-codes';
import { CreateRoomDto } from './dto/create-room.dto';
import { LiveKitRoomService, LiveParticipantInfo } from './livekit-room.service';
import { ProjectScope } from '../../shared/environment/environment.constants';

export interface RoomWithLiveState extends Room {
  /** Participants actually connected in LiveKit right now. `null` means LiveKit could not be reached — distinct from a genuinely idle 0. */
  liveParticipantCount: number | null;
}

export interface RoomDetailWithLiveState extends RoomWithLiveState {
  liveParticipants: LiveParticipantInfo[] | null;
}

@Injectable()
export class RoomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly liveKitRoomService: LiveKitRoomService,
  ) {}

  async create(scope: ProjectScope, dto: CreateRoomDto): Promise<Room> {
    const { projectId, environment } = scope;
    const existing = await this.prisma.room.findUnique({
      where: { projectId_environment_name: { projectId, environment, name: dto.name } },
    });

    if (existing) {
      throw new ConflictError(
        `A room named "${dto.name}" already exists in this project's ${environment} environment`,
      );
    }

    return this.prisma.room.create({ data: { projectId, environment, name: dto.name } });
  }

  findAllForProject(scope: ProjectScope): Promise<Room[]> {
    return this.prisma.room.findMany({
      where: { projectId: scope.projectId, environment: scope.environment, status: RoomStatus.ACTIVE },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Scoping to project *and* environment (not just id) is what stops one
  // project's API key from reading or closing another project's room, and
  // a development key from touching production, even if it somehow got
  // hold of the room ID. A miss is reported as "not found" rather than
  // "forbidden", so the response never confirms the room exists elsewhere.
  async findOneForProject(id: string, scope: ProjectScope): Promise<Room> {
    const room = await this.prisma.room.findUnique({ where: { id } });
    if (!room || room.projectId !== scope.projectId || room.environment !== scope.environment) {
      throw new NotFoundError('Room', RavenErrorCode.ROOM_NOT_FOUND);
    }
    return room;
  }

  async close(id: string, scope: ProjectScope): Promise<void> {
    await this.findOneForProject(id, scope);
    await this.prisma.room.update({
      where: { id },
      data: { status: RoomStatus.CLOSED },
    });
  }

  /** Dashboard-facing: control-plane rooms enriched with live LiveKit participant counts. */
  async findAllForProjectWithLiveState(scope: ProjectScope): Promise<RoomWithLiveState[]> {
    const rooms = await this.findAllForProject(scope);
    const liveCounts = await this.liveKitRoomService.listLiveParticipantCounts(rooms.map((r) => r.name));

    return rooms.map((room) => ({
      ...room,
      liveParticipantCount: liveCounts ? liveCounts.get(room.name) ?? 0 : null,
    }));
  }

  /** Dashboard-facing: one room's control-plane record plus its live participants/tracks. */
  async findOneForProjectWithLiveState(id: string, scope: ProjectScope): Promise<RoomDetailWithLiveState> {
    const room = await this.findOneForProject(id, scope);
    const liveParticipants = await this.liveKitRoomService.listLiveParticipants(room.name);

    return {
      ...room,
      liveParticipantCount: liveParticipants ? liveParticipants.length : null,
      liveParticipants: liveParticipants ?? null,
    };
  }
}
