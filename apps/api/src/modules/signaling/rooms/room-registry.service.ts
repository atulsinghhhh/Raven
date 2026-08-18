import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ParticipantSession } from '../interfaces/participant-session.interface';
import { SignalingError } from '../signaling-error';
import { SignalingErrorCode } from '../signaling.constants';

export interface JoinResult {
  // Previous session for the same participantId, if any — caller has to
  // close its socket. Identity comes from the token, not the connection.
  replaced: ParticipantSession | null;
  /** Participants already in the room before this join, for room.joined. */
  existingParticipants: ParticipantSession[];
}

/**
 * Ephemeral, in-memory room/participant state for a single signaling
 * instance. Not persisted to Postgres — this is transient state that
 * shouldn't live there — and not Redis-backed either yet. See
 * docs/signaling.md#multi-instance for how that'd change once we run
 * more than one instance.
 */
@Injectable()
export class RoomRegistryService {
  private readonly logger = new Logger(RoomRegistryService.name);
  private readonly rooms = new Map<string, Map<string, ParticipantSession>>();

  constructor(private readonly configService: ConfigService) {}

  join(session: ParticipantSession): JoinResult {
    const maxParticipants = this.configService.get<number>('signaling.maxParticipantsPerRoom')!;
    let room = this.rooms.get(session.roomId);

    if (!room) {
      room = new Map();
      this.rooms.set(session.roomId, room);
    }

    const replaced = room.get(session.participantId) ?? null;

    if (!replaced && room.size >= maxParticipants) {
      throw new SignalingError(
        SignalingErrorCode.ROOM_FULL,
        `Room has reached its maximum of ${maxParticipants} participants`,
      );
    }

    const existingParticipants = Array.from(room.values()).filter(
      (p) => p.participantId !== session.participantId,
    );

    room.set(session.participantId, session);
    this.logger.log(
      `participant ${session.participantId} joined room ${session.roomId} (${room.size} total)`,
    );

    return { replaced, existingParticipants };
  }

  leave(roomId: string, participantId: string): ParticipantSession | null {
    const room = this.rooms.get(roomId);
    if (!room) {
      return null;
    }

    const session = room.get(participantId) ?? null;
    if (session) {
      room.delete(participantId);
      this.logger.log(`participant ${participantId} left room ${roomId} (${room.size} remain)`);
    }

    if (room.size === 0) {
      this.rooms.delete(roomId);
    }

    return session;
  }

  get(roomId: string, participantId: string): ParticipantSession | undefined {
    return this.rooms.get(roomId)?.get(participantId);
  }

  listParticipants(roomId: string, excludingParticipantId?: string): ParticipantSession[] {
    const room = this.rooms.get(roomId);
    if (!room) {
      return [];
    }
    return Array.from(room.values()).filter((p) => p.participantId !== excludingParticipantId);
  }

  /** For observability — not exposed over the wire protocol. */
  getMetrics(): { activeRooms: number; activeParticipants: number } {
    let activeParticipants = 0;
    for (const room of this.rooms.values()) {
      activeParticipants += room.size;
    }
    return { activeRooms: this.rooms.size, activeParticipants };
  }
}
