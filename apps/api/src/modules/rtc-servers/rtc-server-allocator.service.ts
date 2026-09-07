import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RtcServer, RtcServerStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { AppError } from '../../shared/errors/app-error';
import { RavenErrorCode } from '../../shared/errors/error-codes';
import { HttpStatus } from '@nestjs/common';
import { RedisService } from '../../shared/redis/redis.service';

/**
 * How long an allocation lock is held. Long enough to cover the database
 * round-trips an allocation makes, short enough that a process dying
 * mid-allocation doesn't block the room for a noticeable time. The lock is
 * an optimisation, not a correctness mechanism — see `allocate`.
 */
const ALLOCATION_LOCK_TTL_SECONDS = 10;

export class NoRtcCapacityError extends AppError {
  constructor(region: string) {
    super(
      `No healthy RTC server with spare capacity in region "${region}"`,
      HttpStatus.SERVICE_UNAVAILABLE,
      RavenErrorCode.NO_RTC_CAPACITY,
      { region },
    );
  }
}

const allocationLockKey = (roomId: string) => `raven:rtc:alloc:${roomId}`;

/**
 * Decides which SFU serves a room, and records that decision (spec §22,
 * §25).
 *
 * The decision is made once per room session and then *remembered* on the
 * room row. Every participant joining a room must land on the same SFU —
 * that is what makes it an SFU rather than a mesh — so allocation is
 * fundamentally "look up the existing assignment, or make one if there
 * isn't one", not "pick a server per participant".
 *
 * Room migration is deliberately absent. Moving a live room between SFUs
 * means renegotiating every participant's PeerConnection, and spec §25
 * says to avoid unnecessary migration while designing the abstraction for
 * it now: that abstraction is `assignedServerFor` / `releaseRoom` — a
 * future migration path changes the assignment and re-signals, without
 * anything else in the control plane needing to know allocation can move.
 */
@Injectable()
export class RtcServerAllocatorService {
  private readonly logger = new Logger(RtcServerAllocatorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Returns the SFU serving this room, allocating one if it has none.
   *
   * Concurrency: two participants joining an empty room at the same
   * moment could each allocate. A Redis lock makes that rare, and the
   * conditional write below makes it harmless — the second writer's
   * `updateMany` matches nothing because `rtcServerId` is no longer null,
   * so it re-reads and uses the winner's choice. Correctness therefore
   * does not depend on Redis being up, which matters because a room join
   * failing when Redis hiccups would be a much worse failure than an
   * occasional wasted allocation attempt.
   */
  async allocate(roomId: string, requestedRegion?: string): Promise<RtcServer> {
    const existing = await this.assignedServerFor(roomId);
    if (existing) {
      return existing;
    }

    const lock = await this.acquireLock(roomId);
    try {
      // Re-check after the lock: whoever held it before us probably
      // allocated already.
      const afterLock = await this.assignedServerFor(roomId);
      if (afterLock) {
        return afterLock;
      }

      const region = requestedRegion ?? this.configService.get<string>('sfu.defaultRegion')!;
      const candidate = await this.pickServer(region);

      const { count } = await this.prisma.room.updateMany({
        // The null guard is what makes a lost race harmless rather than a
        // room whose participants are split across two SFUs.
        where: { id: roomId, rtcServerId: null },
        data: { rtcServerId: candidate.id },
      });

      if (count === 0) {
        const winner = await this.assignedServerFor(roomId);
        if (winner) {
          this.logger.debug(`room ${roomId} was allocated concurrently — using ${winner.name}`);
          return winner;
        }
        // The room row disappeared between the capacity check and the
        // write. Rare, and not something to paper over with a retry loop.
        throw new NoRtcCapacityError(region);
      }

      this.logger.log(
        `room ${roomId} allocated to rtc server ${candidate.name} (region=${candidate.region}, ${candidate.activeRooms}/${candidate.capacity} rooms)`,
      );
      return candidate;
    } finally {
      await this.releaseLock(lock);
    }
  }

  /**
   * One server by id, for callers holding a cached assignment.
   *
   * Signaling caches a session's server so that every ICE candidate — of
   * which there are dozens per join — does not cost a room lookup on the
   * latency-sensitive path of establishing a connection.
   */
  async serverById(id: string): Promise<RtcServer | null> {
    return this.prisma.rtcServer.findUnique({ where: { id } });
  }

  /** The room's current SFU, or null if it has no live media session. */
  async assignedServerFor(roomId: string): Promise<RtcServer | null> {
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      select: { rtcServer: true },
    });
    return room?.rtcServer ?? null;
  }

  /**
   * Drops the room's assignment, so its next join allocates fresh.
   *
   * Called when the last participant leaves. Keeping a stale assignment
   * would pin an empty room to a node that might since have been drained
   * or replaced.
   */
  async releaseRoom(roomId: string): Promise<void> {
    const { count } = await this.prisma.room.updateMany({
      where: { id: roomId, rtcServerId: { not: null } },
      data: { rtcServerId: null },
    });
    if (count > 0) {
      this.logger.log(`room ${roomId} released — no longer assigned to an rtc server`);
    }
  }

  /**
   * Picks the least-loaded healthy server, preferring the requested region
   * and falling back to any region rather than failing the call.
   *
   * The fallback is the right default for a call that would otherwise not
   * happen: a participant connected to a distant SFU has worse latency,
   * but a participant who cannot connect has no call at all. Region is
   * therefore a preference, not a constraint — and the log line says when
   * it was not honoured, so a systematically mis-served region is visible
   * rather than silently degrading.
   *
   * "Least loaded" is by active rooms, not participants: rooms are what
   * this allocator hands out, and a node's cost is dominated by the number
   * of forwarding paths, which grows with participants *within* the rooms
   * it already holds. Balancing rooms keeps that growth spread out.
   */
  private async pickServer(region: string): Promise<RtcServer> {
    const inRegion = await this.healthyServersWithCapacity(region);
    if (inRegion.length > 0) {
      return inRegion[0];
    }

    const anywhere = await this.healthyServersWithCapacity();
    if (anywhere.length === 0) {
      throw new NoRtcCapacityError(region);
    }

    this.logger.warn(
      `no healthy rtc server with capacity in region "${region}" — falling back to ${anywhere[0].name} in "${anywhere[0].region}"`,
    );
    return anywhere[0];
  }

  private async healthyServersWithCapacity(region?: string): Promise<RtcServer[]> {
    const servers = await this.prisma.rtcServer.findMany({
      where: {
        // DRAINING and UNHEALTHY are both excluded here, for different
        // reasons that happen to have the same effect: one was taken out
        // deliberately, the other stopped answering.
        status: RtcServerStatus.HEALTHY,
        ...(region ? { region } : {}),
      },
      orderBy: [{ activeRooms: 'asc' }, { activeParticipants: 'asc' }],
    });

    // Capacity is filtered in code rather than SQL because it compares two
    // columns, which Prisma's `where` cannot express.
    return servers.filter((server) => server.activeRooms < server.capacity);
  }

  private async acquireLock(roomId: string): Promise<string | null> {
    try {
      const result = await this.redisService.client.set(
        allocationLockKey(roomId),
        '1',
        'EX',
        ALLOCATION_LOCK_TTL_SECONDS,
        'NX',
      );
      return result === 'OK' ? allocationLockKey(roomId) : null;
    } catch (err) {
      // Redis down means we allocate without the lock. The conditional
      // write keeps that safe; see the note on `allocate`.
      this.logger.warn(`allocation lock unavailable, proceeding without it: ${(err as Error).message}`);
      return null;
    }
  }

  private async releaseLock(key: string | null): Promise<void> {
    if (!key) {
      return;
    }
    try {
      await this.redisService.client.del(key);
    } catch {
      // The TTL cleans up after us.
    }
  }
}
