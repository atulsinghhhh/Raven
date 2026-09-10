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

/**
 * The node this room is pinned to is not healthy, and the room cannot be
 * moved off it because it still holds participants.
 *
 * Deliberately not `NoRtcCapacityError`. That one means the fleet had
 * nowhere to *put* a new room, and the honest advice is "try later or a
 * different region". This one means there is a specific node that owns this
 * room's media session and has stopped answering — the fleet may be
 * perfectly healthy otherwise. Telling a caller "no capacity" would send
 * them looking at fleet size for what is one sick node.
 */
export class RtcServerUnavailableError extends AppError {
  constructor(roomId: string, serverName: string) {
    super(
      `The RTC server hosting this room is not currently healthy — retry shortly`,
      HttpStatus.SERVICE_UNAVAILABLE,
      RavenErrorCode.RTC_SERVER_UNAVAILABLE,
      // The node's *name*, not its address. Same rule as `room.joined`:
      // a caller that learned an SFU's address could route around the
      // control plane, and then the media plane could never change.
      { roomId, rtcServer: serverName },
    );
  }
}

const allocationLockKey = (roomId: string) => `raven:rtc:alloc:${roomId}`;

/**
 * How the allocator finds out whether a room still has anybody in it.
 *
 * Passed in rather than injected, because fleet-wide occupancy lives in
 * `RoomRegistryService`, which is part of signaling — and signaling imports
 * *this* module. Taking a closure keeps the dependency pointing one way and
 * keeps this module's "depends on nothing else in the application" property
 * true.
 */
export type RoomOccupancyProbe = () => Promise<boolean>;

export interface AllocateOptions {
  requestedRegion?: string;
  /**
   * Whether the room still holds participants, asked only when the pinned
   * node has gone unhealthy.
   *
   * Absent means "assume occupied", which is the safe direction: releasing
   * the pin under a room that is in fact live would split its participants
   * across two SFUs, and they would not be able to see or hear each other.
   * A wrong "unavailable" is a retry; a wrong release is a broken call.
   */
  isRoomOccupied?: RoomOccupancyProbe;
}

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
  async allocate(roomId: string, options: AllocateOptions | string = {}): Promise<RtcServer> {
    // A bare region string used to be the second argument. Kept working
    // rather than chased through every caller: this is a published module
    // boundary and the two shapes are unambiguous.
    const { requestedRegion, isRoomOccupied } = typeof options === 'string' ? { requestedRegion: options } : options;

    const existing = await this.assignedServerFor(roomId);
    if (existing) {
      const usable = await this.reusePin(roomId, existing, isRoomOccupied);
      if (usable) {
        return usable;
      }
      // The pin pointed at a dead node and the room was empty, so it has
      // just been cleared. Fall through and allocate as if fresh.
    }

    const lock = await this.acquireLock(roomId);
    try {
      // Re-check now we hold the lock. Whoever had it before us has
      // probably allocated already.
      const afterLock = await this.assignedServerFor(roomId);
      if (afterLock) {
        const usable = await this.reusePin(roomId, afterLock, isRoomOccupied);
        if (usable) {
          return usable;
        }
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
   * Decides whether a room's existing pin can still be used.
   *
   * Returns the server when the pin is good, or `null` when it pointed at a
   * dead node and the room was empty — in which case the pin has been
   * cleared and the caller should allocate fresh. Throws
   * `RtcServerUnavailableError` when the node is dead but the room is still
   * occupied.
   *
   * # Why a pinned room has to be health-checked at all
   *
   * It did not used to be: `allocate` returned the assignment unconditionally.
   * That is correct right up until the node stops heartbeating, and then it
   * is the worst possible answer. `markStaleServersUnhealthy` moves the node
   * to UNHEALTHY, which stops it receiving *new* rooms — but every room
   * already pinned to it kept sending joiners there, each one failing with
   * `RTC_SERVER_UNREACHABLE` and retrying into the same corpse. And because
   * the pin is only released by `releaseRoomIfEmpty` on a clean leave, a
   * room whose participants all died with the node stayed pinned to it
   * indefinitely. Nothing recovered it: the node was excluded from
   * allocation, so it could never be picked again, and the pin was never
   * cleared, so nothing else could be either.
   *
   * # Why DRAINING is still usable
   *
   * Draining means "take no new rooms", not "drop the ones you have" —
   * that is the whole point of it, and `setDraining` is documented as
   * letting existing rooms finish. `pickServer` already excludes DRAINING
   * from *new* allocations, which is where the flag belongs. Refusing
   * joiners to a room already living on a draining node would turn a
   * graceful upgrade into an outage.
   *
   * # Why an occupied room is never moved
   *
   * Moving a live room between SFUs means renegotiating every
   * participant's PeerConnection against a node that has none of their
   * media state. There is no mechanism for that here (see this class's
   * header, and spec §25), so the choice is between failing the new joiner
   * and corrupting the call for everybody already in it. It fails the
   * joiner. The room is preserved and recovers by itself the moment the
   * node heartbeats again — which is exactly why the sweep marks nodes
   * unhealthy rather than deleting them.
   */
  private async reusePin(
    roomId: string,
    pinned: RtcServer,
    isRoomOccupied?: RoomOccupancyProbe,
  ): Promise<RtcServer | null> {
    if (pinned.status !== RtcServerStatus.UNHEALTHY) {
      return pinned;
    }

    // No probe means "assume occupied". See AllocateOptions.
    const occupied = isRoomOccupied ? await isRoomOccupied() : true;
    if (occupied) {
      this.logger.error(
        `room ${roomId} is pinned to unhealthy rtc server ${pinned.name} and still has participants — ` +
          'refusing the join rather than migrating a live media session',
      );
      throw new RtcServerUnavailableError(roomId, pinned.name);
    }

    // Empty room on a dead node: nothing to corrupt, so let go of the pin.
    // Conditional on the id it still holds, so a concurrent allocation that
    // already re-pinned this room to a healthy node is not undone.
    const { count } = await this.prisma.room.updateMany({
      where: { id: roomId, rtcServerId: pinned.id },
      data: { rtcServerId: null },
    });
    if (count === 0) {
      // Somebody else got there first. Take whatever they chose.
      return this.assignedServerFor(roomId);
    }

    this.logger.warn(
      `room ${roomId} was pinned to unhealthy rtc server ${pinned.name} but is empty — ` +
        'released, reallocating to a healthy node',
    );
    return null;
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
