import { Injectable } from '@nestjs/common';
import { Room, RoomStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { ConflictError, NotFoundError } from '../../shared/errors/app-error';
import { RavenErrorCode } from '../../shared/errors/error-codes';
import { CreateRoomDto } from './dto/create-room.dto';
import { LiveKitRoomService, LiveParticipantInfo } from './livekit-room.service';

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

  async create(projectId: string, dto: CreateRoomDto): Promise<Room> {
    const existing = await this.prisma.room.findUnique({
      where: { projectId_name: { projectId, name: dto.name } },
    });

    if (existing) {
      throw new ConflictError(`A room named "${dto.name}" already exists in this project`);
    }

    return this.prisma.room.create({ data: { projectId, name: dto.name } });
  }

  findAllForProject(projectId: string): Promise<Room[]> {
    return this.prisma.room.findMany({
      where: { projectId, status: RoomStatus.ACTIVE },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Scoping to projectId (not just id) is what stops one project's API
  // key from reading or closing another project's room, even if it
  // somehow got hold of the room ID.
  async findOneForProject(id: string, projectId: string): Promise<Room> {
    const room = await this.prisma.room.findUnique({ where: { id } });
    if (!room || room.projectId !== projectId) {
      throw new NotFoundError('Room', RavenErrorCode.ROOM_NOT_FOUND);
    }
    return room;
  }

  async close(id: string, projectId: string): Promise<void> {
    await this.findOneForProject(id, projectId);
    await this.prisma.room.update({
      where: { id },
      data: { status: RoomStatus.CLOSED },
    });
  }

  /** Dashboard-facing: control-plane rooms enriched with live LiveKit participant counts. */
  async findAllForProjectWithLiveState(projectId: string): Promise<RoomWithLiveState[]> {
    const rooms = await this.findAllForProject(projectId);
    const liveCounts = await this.liveKitRoomService.listLiveParticipantCounts(rooms.map((r) => r.name));

    return rooms.map((room) => ({
      ...room,
      liveParticipantCount: liveCounts ? liveCounts.get(room.name) ?? 0 : null,
    }));
  }

  /** Dashboard-facing: one room's control-plane record plus its live participants/tracks. */
  async findOneForProjectWithLiveState(id: string, projectId: string): Promise<RoomDetailWithLiveState> {
    const room = await this.findOneForProject(id, projectId);
    const liveParticipants = await this.liveKitRoomService.listLiveParticipants(room.name);

    return {
      ...room,
      liveParticipantCount: liveParticipants ? liveParticipants.length : null,
      liveParticipants: liveParticipants ?? null,
    };
  }
}
