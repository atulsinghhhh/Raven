import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { RedisService } from '../../../shared/redis/redis.service';
import { ParticipantSession } from '../interfaces/participant-session.interface';
import { SignalingError } from '../signaling-error';
import { SIGNALING_PARTICIPANT_TTL_SECONDS, SignalingErrorCode, SignalingRedisKeys } from '../signaling.constants';

export interface JoinResult {
  /** Fleet-wide, minus the joining participant. Ids only, since a remote one has no local socket to hand back. */
  existingParticipantIds: string[];
  /**
   * True when this participantId was already in the room fleet-wide before
   * this join. In other words a reconnect, possibly landing on a different
   * instance from its own stale session. The caller uses it to decide
   * whether that stale session needs a fleet-wide kick.
   */
  wasReconnect: boolean;
}

/**
 * Room and participant state for the signaling plane, fleet-wide.
 *
 * There are two views, the same split chat's connection registry uses. A
 * **local** `Map` covers participants whose socket this exact instance
 * holds, giving zero-round-trip lookups when routing to a target we already
 * know about. A **Redis-backed fleet view**
 * (`SignalingRedisKeys.roomParticipants`/`participant`) makes participants
 * reachable whichever instance they connected to.
 *
 * Every fleet key carries a TTL, set on join and re-armed on every
 * heartbeat tick via `refresh()`, so a gateway that dies without cleaning
 * up doesn't leave phantom participants lying about — but a participant who
 * simply stays connected past the TTL doesn't silently fall out of the
 * fleet view either. Same reasoning as chat's connection registry, and
 * equivalent to chat's spec §35.
 *
 * See docs/rtc/scaling.md#a-room-split-across-api-instances.
 */
@Injectable()
export class RoomRegistryService {
  private readonly logger = new Logger(RoomRegistryService.name);
  private readonly rooms = new Map<string, Map<string, ParticipantSession>>();
  /** Identifies this process within a fleet. Same shape as chat's ConnectionRegistryService.gatewayId. */
  readonly gatewayId = `gw_${process.pid.toString(36)}_${randomBytes(3).toString('hex')}`;

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * `maxParticipants` lets a caller override the generic room ceiling —
   * used for a live-stream room, whose free-tier viewer cap
   * (`usage.live.maxViewers`) plus hosts/co-hosts would otherwise be
   * unreachable behind the default. The caller (MessageRouterService)
   * already knows whether this room backs a stream from the same query it
   * uses to decide which usage product this join meters against, so no
   * second lookup happens here.
   */
  async join(session: ParticipantSession, opts: { maxParticipants?: number } = {}): Promise<JoinResult> {
    const maxParticipants = opts.maxParticipants ?? this.configService.get<number>('signaling.maxParticipantsPerRoom')!;
    const participantsKey = SignalingRedisKeys.roomParticipants(session.roomId);

    let fleetParticipantIds: string[];
    try {
      fleetParticipantIds = await this.redisService.client.smembers(participantsKey);
    } catch (err) {
      // Redis unreachable, so fail open onto the local-only view rather
      // than refuse every join in the fleet. A single-instance deployment,
      // or a Redis blip, should behave the way it did before this fix
      // existed.
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

  /** Local-only lookup: a target this instance can deliver to directly, no Redis round trip. */
  get(roomId: string, participantId: string): ParticipantSession | undefined {
    return this.rooms.get(roomId)?.get(participantId);
  }

  /**
   * Heartbeat refresh: re-arms the fleet-wide TTL for a participant already
   * known to be in the room. Call this on every heartbeat tick a session
   * answers, the same way chat's `ConnectionRegistryService.touch()` rides
   * its own gateway's heartbeat sweep.
   *
   * Deliberately `EXPIRE`-only, never `SADD`/`SET`: those would resurrect a
   * membership that already lapsed, which is exactly the phantom entry a
   * heartbeat must not create. If the fleet view already forgot this
   * participant, only a fresh `join()` should bring them back — a stray or
   * late heartbeat doing it instead would hide the same staleness this fix
   * exists to catch. `EXPIRE` on a key that's gone is a documented no-op
   * (returns 0), so this degrades safely on its own without an existence
   * check first.
   */
  async refresh(roomId: string, participantId: string): Promise<void> {
    // No local session for this participant in this room: nothing to keep
    // alive. Guards a heartbeat tick that lands after disconnect, and a
    // session that hasn't joined a room yet.
    if (!this.get(roomId, participantId)) {
      return;
    }

    try {
      await this.redisService.client
        .multi()
        .expire(SignalingRedisKeys.roomParticipants(roomId), SIGNALING_PARTICIPANT_TTL_SECONDS)
        .expire(SignalingRedisKeys.participant(roomId, participantId), SIGNALING_PARTICIPANT_TTL_SECONDS)
        .exec();
    } catch (err) {
      this.logger.warn(
        `fleet TTL refresh failed for participant ${participantId} in room ${roomId}: ${(err as Error).message}`,
      );
    }
  }

  /** Local-only listing. Used for local delivery, and as the Redis-unavailable fallback above. */
  listParticipants(roomId: string, excludingParticipantId?: string): ParticipantSession[] {
    const room = this.rooms.get(roomId);
    if (!room) {
      return [];
    }
    return Array.from(room.values()).filter((p) => p.participantId !== excludingParticipantId);
  }

  /**
   * Fleet-wide existence check, used only when a relay target for sdp or ice
   * isn't held locally. That way a two-participant call on one instance
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
      // Fail closed here, not open. The alternative is relaying an SDP
      // offer or ICE candidate into the void, because we guessed a target
      // existed when we couldn't actually confirm it.
      this.logger.warn(
        `fleet existence check failed for participant ${participantId} in room ${roomId}: ${(err as Error).message}`,
      );
      return false;
    }
  }

  /**
   * How many participants the room holds fleet-wide.
   *
   * Used to work out whether a departure emptied the room, which the local
   * view can't answer: the last participant on *this* instance isn't
   * necessarily the last one in the room.
   *
   * When Redis is unreachable this fails closed at 1, not 0. Report "empty"
   * off a failed read and you release a live room's RTC server assignment,
   * and the next participant to join gets allocated a different node from
   * the people already talking.
   */
  async countFleetWide(roomId: string): Promise<number> {
    try {
      return await this.redisService.client.scard(SignalingRedisKeys.roomParticipants(roomId));
    } catch (err) {
      this.logger.warn(`fleet count failed for room ${roomId}, assuming not empty: ${(err as Error).message}`);
      return 1;
    }
  }

  /**
   * For /health. Local-instance only, on purpose, so a liveness or readiness
   * probe stays cheap and pays no Redis round trip. Fleet-wide counts belong
   * on the /metrics surface instead.
   */
  getMetrics(): { activeRooms: number; activeParticipants: number } {
    let activeParticipants = 0;
    for (const room of this.rooms.values()) {
      activeParticipants += room.size;
    }
    return { activeRooms: this.rooms.size, activeParticipants };
  }
}
