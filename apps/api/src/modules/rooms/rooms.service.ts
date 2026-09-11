import { Injectable } from '@nestjs/common';
import { Room, RoomStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { ConflictError, NotFoundError } from '../../shared/errors/app-error';
import { RavenErrorCode } from '../../shared/errors/error-codes';
import { RoomEventsService } from '../signaling/rooms/room-events.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { LiveParticipantInfo, SfuRoomStateService } from './sfu-room-state.service';
import { ProjectScope } from '../../shared/environment/environment.constants';

export interface RoomWithLiveState extends Room {
  /** Participants actually connected to the room's SFU node right now. `null` means the node could not be reached: distinct from a genuinely idle 0. */
  liveParticipantCount: number | null;
}

export interface RoomDetailWithLiveState extends RoomWithLiveState {
  liveParticipants: LiveParticipantInfo[] | null;
}

@Injectable()
export class RoomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly roomState: SfuRoomStateService,
    private readonly roomEvents: RoomEventsService,
  ) {}

  async create(scope: ProjectScope, dto: CreateRoomDto): Promise<Room> {
    const { projectId, environment } = scope;
    const existing = await this.prisma.room.findUnique({
      where: { projectId_environment_name: { projectId, environment, name: dto.name } },
    });

    if (existing) {
      throw new ConflictError(`A room named "${dto.name}" already exists in this project's ${environment} environment`);
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

  /**
   * Closes a room: the control-plane record *and* the live media session.
   *
   * The record used to be all of it, which made "closed" a statement about
   * a database row and nothing else. A closed room — and an ended live
   * stream, which closes its room — went on forwarding media indefinitely:
   * the host still publishing, viewers still decoding, usage still
   * accruing, and no client ever told. The frame that stops it had been
   * implemented on the node the whole time and was never sent.
   *
   * Order matters. The row goes first, because it is what refuses
   * re-admission, and a caller that got a 2xx must never find the room
   * still joinable. The media plane and the signaling sockets follow, and
   * neither can fail the close: a node or a Redis that cannot be reached
   * leaves a session running a little longer, which is a degraded close,
   * not a failed one. The alternative — throwing after the row is already
   * CLOSED — would report failure for work that mostly succeeded and
   * invite a retry that has nothing left to do.
   */
  async close(id: string, scope: ProjectScope): Promise<void> {
    await this.findOneForProject(id, scope);
    await this.prisma.room.update({
      where: { id },
      data: { status: RoomStatus.CLOSED },
    });

    await this.roomState.closeLiveSession(id);
    // Tell the participants before their PeerConnections simply stop
    // working, so a client can render "this ended" instead of a stall.
    await this.roomEvents.publish(id, { kind: 'closed' });
  }

  /**
   * Dashboard-facing: control-plane rooms enriched with live participant
   * counts from whichever SFU is serving each one.
   *
   * `liveParticipantCount` is `null` when the media plane could not be
   * asked, and a number when it answered: including `0` for an idle
   * room. The distinction is the point: rendering "unknown" as zero would
   * tell an operator every room is empty during a partition.
   */
  async findAllForProjectWithLiveState(scope: ProjectScope): Promise<RoomWithLiveState[]> {
    const rooms = await this.findAllForProject(scope);
    const liveCounts = await this.roomState.listLiveParticipantCounts(rooms.map((r) => r.id));

    return rooms.map((room) => ({
      ...room,
      liveParticipantCount: liveCounts ? (liveCounts.get(room.id) ?? null) : null,
    }));
  }

  /** Dashboard-facing: one room's control-plane record plus its live participants/tracks. */
  async findOneForProjectWithLiveState(id: string, scope: ProjectScope): Promise<RoomDetailWithLiveState> {
    const room = await this.findOneForProject(id, scope);
    const liveParticipants = await this.roomState.listLiveParticipants(room.id);

    return {
      ...room,
      liveParticipantCount: liveParticipants ? liveParticipants.length : null,
      liveParticipants: liveParticipants ?? null,
    };
  }
}
