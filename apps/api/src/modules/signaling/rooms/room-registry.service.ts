import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { RedisService } from '../../../shared/redis/redis.service';
import { ParticipantSession } from '../interfaces/participant-session.interface';
import { SignalingError } from '../signaling-error';
import { SIGNALING_PARTICIPANT_TTL_SECONDS, SignalingErrorCode, SignalingRedisKeys } from '../signaling.constants';

export interface JoinResult {
  /** Fleet-wide, excluding the joining participant — ids only, since a remote one has no local socket to hand back. */
  existingParticipantIds: string[];
  /**
   * True when this participantId was already present in the room
   * (fleet-wide) before this join — i.e. a reconnect, possibly landing on
   * a different instance than its stale session. The caller uses this to
   * decide whether a fleet-wide kick of the stale session is needed.
   */
  wasReconnect: boolean;
}

/**
 * Room/participant state for the signaling plane, fleet-wide.
 *
 * Two views are kept, same split as chat's connection registry:
 * a **local** `Map` for participants whose socket this exact instance
 * holds (used for zero-round-trip lookups when routing a message to a
 * target this instance already knows about), and a **Redis-backed fleet
 * view** (`SignalingRedisKeys.roomParticipants`/`participant`) so
 * participants are reachable regardless of which instance they connected
 * to. Every fleet key carries a TTL, refreshed on join, so a gateway that
 * dies without cleaning up doesn't leave phantom participants behind
 * (mirrors chat's connection-registry reasoning, spec-equivalent to
 * chat's spec §35).
 *
 * See docs/signaling.md#multi-instance-readiness.
 */
@Injectable()
export class RoomRegistryService {
  private readonly logger = new Logger(RoomRegistryService.name);
  private readonly rooms = new Map<string, Map<string, ParticipantSession>>();
  /** Identifies this process in a fleet — same shape as chat's ConnectionRegistryService.gatewayId. */
  readonly gatewayId = `gw_${process.pid.toString(36)}_${randomBytes(3).toString('hex')}`;

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {}

  async join(session: ParticipantSession): Promise<JoinResult> {
    const maxParticipants = this.configService.get<number>('signaling.maxParticipantsPerRoom')!;
    const participantsKey = SignalingRedisKeys.roomParticipants(session.roomId);

    let fleetParticipantIds: string[];
    try {
      fleetParticipantIds = await this.redisService.client.smembers(participantsKey);
    } catch (err) {
      // Redis unreachable: fail open onto the local-only view rather than
      // refusing every join in the fleet — a single-instance deployment
      // (or a Redis blip) should behave like before this fix existed.
      this.logger.warn(
        `fleet membership read failed for room ${session.roomId}, falling back to local view: ${(err as Error).message}`,
      );
      fleetParticipantIds = this.listParticipants(session.roomId).map((p) => p.participantId);
    }

    const wasReconnect = fleetParticipantIds.includes(session.participantId);
    if (!wasReconnect && fleetParticipantIds.length >= maxParticipants) {
      throw new SignalingError(
        SignalingErrorCode.ROOM_FULL,
        `Room has reached its maximum of ${maxParticipants} participants`,
      );
    }

    let room = this.rooms.get(session.roomId);
    if (!room) {
      room = new Map();
      this.rooms.set(session.roomId, room);
    }
    room.set(session.participantId, session);

    try {
      await this.redisService.client
        .multi()
        .sadd(participantsKey, session.participantId)
        .expire(participantsKey, SIGNALING_PARTICIPANT_TTL_SECONDS)
        .set(
          SignalingRedisKeys.participant(session.roomId, session.participantId),
          JSON.stringify({ gatewayId: this.gatewayId }),
          'EX',
          SIGNALING_PARTICIPANT_TTL_SECONDS,
        )
        .exec();
    } catch (err) {
      this.logger.warn(
        `fleet registration failed for participant ${session.participantId} in room ${session.roomId}: ${(err as Error).message}`,
      );
    }

    const existingParticipantIds = fleetParticipantIds.filter((id) => id !== session.participantId);
    this.logger.log(
      `participant ${session.participantId} joined room ${session.roomId} (${existingParticipantIds.length + 1} total fleet-wide)`,
    );

    return { existingParticipantIds, wasReconnect };
  }

  async leave(roomId: string, participantId: string): Promise<ParticipantSession | null> {
    const room = this.rooms.get(roomId);
    const session = room?.get(participantId) ?? null;

    if (session) {
      room!.delete(participantId);
      if (room!.size === 0) {
        this.rooms.delete(roomId);
      }
    }

    try {
      await this.redisService.client
        .multi()
        .srem(SignalingRedisKeys.roomParticipants(roomId), participantId)
        .del(SignalingRedisKeys.participant(roomId, participantId))
        .exec();
    } catch (err) {
      this.logger.warn(
        `fleet cleanup failed for participant ${participantId} in room ${roomId}: ${(err as Error).message}`,
      );
    }

    if (session) {
      this.logger.log(`participant ${participantId} left room ${roomId}`);
    }

    return session;
  }

  /** Local-only lookup — a target this instance can deliver to directly, no Redis round trip. */
  get(roomId: string, participantId: string): ParticipantSession | undefined {
    return this.rooms.get(roomId)?.get(participantId);
  }

  /** Local-only listing — used for local delivery and as the Redis-unavailable fallback above. */
  listParticipants(roomId: string, excludingParticipantId?: string): ParticipantSession[] {
    const room = this.rooms.get(roomId);
    if (!room) {
      return [];
    }
    return Array.from(room.values()).filter((p) => p.participantId !== excludingParticipantId);
  }

  /**
   * Fleet-wide existence check, used only when a relay target (sdp/ice)
   * isn't held locally — so a two-participant call on the same instance
   * never pays a Redis round trip to resolve its target.
   */
  async existsFleetWide(roomId: string, participantId: string): Promise<boolean> {
    try {
      const result = await this.redisService.client.sismember(
        SignalingRedisKeys.roomParticipants(roomId),
        participantId,
      );
      return result === 1;
    } catch (err) {
      // Fail closed here, not open: the alternative is relaying an SDP
      // offer/ICE candidate into the void because we guessed a target
      // exists when we couldn't actually confirm it.
      this.logger.warn(
        `fleet existence check failed for participant ${participantId} in room ${roomId}: ${(err as Error).message}`,
      );
      return false;
    }
  }

  /**
   * For /health — deliberately local-instance-only so a liveness/readiness
   * probe stays cheap (no Redis round trip). Fleet-wide counts belong on
   * the /metrics surface instead.
   */
  getMetrics(): { activeRooms: number; activeParticipants: number } {
    let activeParticipants = 0;
    for (const room of this.rooms.values()) {
      activeParticipants += room.size;
    }
    return { activeRooms: this.rooms.size, activeParticipants };
  }
}
