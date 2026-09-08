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
 * round trips an allocation makes, short enough that a process dying
 * mid-allocation doesn't block the room for any noticeable time.
 *
 * The lock is an optimisation, not a correctness mechanism. See `allocate`.
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
 * Decides which SFU serves a room, and remembers that decision (spec §22,
 * §25).
 *
 * The decision gets made once per room session and then stored on the room
 * row. Every participant joining a room has to land on the same SFU; that's
 * what makes it an SFU rather than a mesh. So allocation is really "look up
 * the existing assignment, or make one if there isn't one", not "pick a
 * server per participant".
 *
 * Room migration is on purpose missing. Moving a live room between SFUs
 * means renegotiating every participant's PeerConnection, and spec §25 says
 * to avoid unnecessary migration while designing the abstraction for it
 * now. That abstraction is `assignedServerFor` and `releaseRoom`: a future
 * migration path changes the assignment and re-signals, and nothing else in
 * the control plane has to learn that allocation can move.
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
   * Returns the SFU serving this room, allocating one if it hasn't got one.
   *
   * On concurrency: two participants joining an empty room at the same
   * instant could each try to allocate. A Redis lock makes that rare, and
   * the conditional write below makes it harmless. The second writer's
   * `updateMany` matches nothing, because `rtcServerId` isn't null any
   * more, so it re-reads and takes the winner's choice.
   *
   * Which means correctness doesn't depend on Redis being up. That matters:
   * a room join failing every time Redis hiccups would be a far worse
   * failure than the occasional wasted allocation attempt.
   */
  async allocate(roomId: string, requestedRegion?: string): Promise<RtcServer> {
    const existing = await this.assignedServerFor(roomId);
    if (existing) {
      return existing;
    }

    const lock = await this.acquireLock(roomId);
    try {
      // Re-check now we hold the lock. Whoever had it before us has
      // probably allocated already.
      const afterLock = await this.assignedServerFor(roomId);
      if (afterLock) {
        return afterLock;
      }

      const region = requestedRegion ?? this.configService.get<string>('sfu.defaultRegion')!;
      const candidate = await this.pickServer(region);

      const { count } = await this.prisma.room.updateMany({
        // The null guard is what turns a lost race into a harmless no-op,
        // instead of a room with its participants split across two SFUs.
        where: { id: roomId, rtcServerId: null },
        data: { rtcServerId: candidate.id },
      });

      if (count === 0) {
        const winner = await this.assignedServerFor(roomId);
        if (winner) {
          this.logger.debug(`room ${roomId} was allocated concurrently — using ${winner.name}`);
          return winner;
        }
        // The room row vanished between the capacity check and the write.
        // Rare, and not something to paper over with a retry loop.
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
   * Signaling caches a session's server so every ICE candidate doesn't cost
   * a room lookup. There are dozens of those per join, right on the
   * latency-sensitive path of getting a connection up.
   */
  async serverById(id: string): Promise<RtcServer | null> {
    return this.prisma.rtcServer.findUnique({ where: { id } });
  }

  /** The room's current SFU, or null when it has no live media session. */
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
   * Runs when the last participant leaves. Hang on to a stale assignment and
   * you pin an empty room to a node that may since have been drained or
   * replaced.
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
   * but falling back to any region, not failing the call.
   *
   * That fallback is the right default for a call that otherwise wouldn't
   * happen. A participant on a distant SFU gets worse latency; a participant
   * who can't connect gets no call. So region is a preference, not a
   * constraint. The log line records when it wasn't honoured, so a
   * systematically mis-served region shows up instead of quietly degrading.
   *
   * "Least loaded" means by active rooms, not participants. Rooms are what
   * this allocator hands out, and a node's cost is dominated by its number
   * of forwarding paths, which grows with participants *inside* the rooms it
   * already holds. Balancing rooms keeps that growth spread about.
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
        // Both DRAINING and UNHEALTHY are excluded, for different reasons
        // that happen to land in the same place: one was taken out
        // on purpose, the other stopped answering.
        status: RtcServerStatus.HEALTHY,
        ...(region ? { region } : {}),
      },
      orderBy: [{ activeRooms: 'asc' }, { activeParticipants: 'asc' }],
    });

    // Capacity gets filtered in code rather than SQL, because it compares
    // two columns and Prisma's `where` can't express that.
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
      // Redis being down means we allocate without the lock. The
      // conditional write keeps that safe; see the note on `allocate`.
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
      // The TTL tidies up after us.
    }
  }
}
