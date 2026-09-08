import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RtcServer, RtcServerStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotFoundError } from '../../shared/errors/app-error';
import { RavenErrorCode } from '../../shared/errors/error-codes';
import { RegisterRtcServerDto } from './dto/register-rtc-server.dto';
import { RtcServerHeartbeatDto } from './dto/rtc-server-heartbeat.dto';

/**
 * How often we sweep for stale nodes. Independent of the heartbeat timeout:
 * that decides *whether* a node is late, this decides how fast we notice.
 *
 * At this frequency a dead node stops getting allocations within roughly
 * one timeout plus one sweep.
 */
const STALE_SWEEP_INTERVAL_MS = 10_000;

/**
 * The fleet's record of which RTC servers exist and how loaded they are
 * (spec §23, §26).
 *
 * The nodes create their own rows on boot and refresh them by heartbeat;
 * the control plane never provisions anything. A node re-registering under
 * a name it's used before reclaims that row instead of adding a second, so
 * restarts and redeploys don't leave phantom entries piling up.
 *
 * Everything in here is a snapshot as of the last heartbeat. Said out loud
 * rather than hidden, because an allocator reading these numbers is always
 * reading something slightly old, and a dashboard showing them needs to say
 * so (see `lastHeartbeatAt`).
 */
@Injectable()
export class RtcServerRegistryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RtcServerRegistryService.name);
  private sweepTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    // Every API instance runs this. The sweep is idempotent: all it ever
    // does is move a node whose heartbeat is already past the deadline into
    // UNHEALTHY. So N instances racing costs N writes on the transition and
    // nothing afterwards. Cheaper than electing a leader for it.
    this.sweepTimer = setInterval(() => void this.markStaleServersUnhealthy(), STALE_SWEEP_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
    }
  }

  /**
   * Called by an SFU when it boots. Idempotent by `name`, so a node that
   * restarts reclaims its row and keeps its history and its id stable for
   * anything referencing it: a room's `rtcServerId`, a log line, a dashboard
   * link.
   *
   * Registration zeroes the load counters rather than trusting whatever the
   * dead process last reported. A freshly booted SFU is serving nothing,
   * whatever the old row claimed.
   */
  async register(dto: RegisterRtcServerDto): Promise<RtcServer> {
    const server = await this.prisma.rtcServer.upsert({
      where: { name: dto.name },
      create: {
        name: dto.name,
        region: dto.region,
        publicHost: dto.publicHost,
        internalUrl: dto.internalUrl,
        capacity: dto.capacity,
        version: dto.version,
        status: RtcServerStatus.HEALTHY,
        lastHeartbeatAt: new Date(),
      },
      update: {
        region: dto.region,
        publicHost: dto.publicHost,
        internalUrl: dto.internalUrl,
        capacity: dto.capacity,
        version: dto.version,
        status: RtcServerStatus.HEALTHY,
        lastHeartbeatAt: new Date(),
        activeRooms: 0,
        activeParticipants: 0,
        cpuPercent: null,
        memoryPercent: null,
        networkInBps: null,
        networkOutBps: null,
      },
    });

    this.logger.log(
      `rtc server registered: name=${server.name} region=${server.region} capacity=${server.capacity} version=${server.version ?? 'unknown'}`,
    );
    return server;
  }

  /**
   * Called by an SFU on its heartbeat interval, carrying its current load.
   *
   * A heartbeat from a node marked UNHEALTHY promotes it straight back to
   * HEALTHY. That's the recovery path spec §26 asks for, and it's exactly
   * why the sweep marks nodes unhealthy instead of deleting them.
   *
   * A node an operator set to DRAINING stays draining. Only an explicit
   * undrain brings it back, because otherwise the next heartbeat quietly
   * undoes the operator's decision.
   */
  async heartbeat(name: string, dto: RtcServerHeartbeatDto): Promise<RtcServer> {
    const existing = await this.prisma.rtcServer.findUnique({ where: { name } });
    if (!existing) {
      // Tell the node to register, rather than quietly conjure a row out of
      // a heartbeat. A heartbeat carries no region, host or capacity, so the
      // row it created would be useless for allocation anyway.
      throw new NotFoundError('RTC server', RavenErrorCode.RTC_SERVER_NOT_FOUND);
    }

    const recovered = existing.status === RtcServerStatus.UNHEALTHY;
    const server = await this.prisma.rtcServer.update({
      where: { name },
      data: {
        lastHeartbeatAt: new Date(),
        activeRooms: dto.activeRooms,
        activeParticipants: dto.activeParticipants,
        cpuPercent: dto.cpuPercent,
        memoryPercent: dto.memoryPercent,
        networkInBps: dto.networkInBps,
        networkOutBps: dto.networkOutBps,
        ...(existing.status === RtcServerStatus.DRAINING ? {} : { status: RtcServerStatus.HEALTHY }),
      },
    });

    if (recovered) {
      this.logger.log(`rtc server recovered: name=${name} — heartbeating again, accepting allocations`);
    }
    return server;
  }

  /**
   * Moves nodes past their heartbeat deadline to UNHEALTHY.
   *
   * Existing rooms on those nodes get left well alone. Spec §26 is explicit
   * that an unhealthy SFU mustn't have its active rooms killed without
   * recovery logic, and a missed heartbeat is very often a paused container
   * or a brief network blip rather than a dead process.
   *
   * All that actually changes is that the node stops getting picked for
   * *new* rooms.
   */
  async markStaleServersUnhealthy(): Promise<number> {
    const timeoutSeconds = this.configService.get<number>('sfu.heartbeatTimeoutSeconds')!;
    const deadline = new Date(Date.now() - timeoutSeconds * 1000);

    try {
      const { count } = await this.prisma.rtcServer.updateMany({
        where: {
          status: { not: RtcServerStatus.UNHEALTHY },
          OR: [{ lastHeartbeatAt: { lt: deadline } }, { lastHeartbeatAt: null }],
        },
        data: { status: RtcServerStatus.UNHEALTHY },
      });

      if (count > 0) {
        this.logger.warn(
          `${count} rtc server(s) missed the ${timeoutSeconds}s heartbeat window — no new allocations; existing rooms left running`,
        );
      }
      return count;
    } catch (err) {
      // A sweep that can't reach the database mustn't take the API down
      // with it. The next tick will try again.
      this.logger.error(`stale-server sweep failed: ${(err as Error).message}`);
      return 0;
    }
  }

  /** Every server in the fleet, newest registration last. Feeds the dashboard and CLI. */
  async list(region?: string): Promise<RtcServer[]> {
    return this.prisma.rtcServer.findMany({
      where: region ? { region } : undefined,
      orderBy: [{ region: 'asc' }, { name: 'asc' }],
    });
  }

  async findByName(name: string): Promise<RtcServer> {
    const server = await this.prisma.rtcServer.findUnique({ where: { name } });
    if (!server) {
      throw new NotFoundError('RTC server', RavenErrorCode.RTC_SERVER_NOT_FOUND);
    }
    return server;
  }

  /**
   * One healthy server, for the readiness probe.
   *
   * The least-loaded healthy node, so a probe doesn't keep landing on the
   * busiest one. `null` when the fleet has nothing healthy registered, which
   * is itself the answer readiness wants: there's nowhere to put a new room.
   */
  async pickHealthyForProbe(): Promise<RtcServer | null> {
    return this.prisma.rtcServer.findFirst({
      where: { status: RtcServerStatus.HEALTHY },
      orderBy: [{ activeRooms: 'asc' }],
    });
  }

  async findById(id: string): Promise<RtcServer | null> {
    return this.prisma.rtcServer.findUnique({ where: { id } });
  }

  /**
   * Takes a node out of the allocation pool without stopping it.
   *
   * The operator-facing half of spec §26. A node being upgraded or poked at
   * should stop taking new rooms and let the ones it has drain naturally,
   * instead of getting killed mid-call.
   */
  async setDraining(name: string, draining: boolean): Promise<RtcServer> {
    await this.findByName(name);
    const server = await this.prisma.rtcServer.update({
      where: { name },
      data: { status: draining ? RtcServerStatus.DRAINING : RtcServerStatus.HEALTHY },
    });
    this.logger.log(`rtc server ${name} ${draining ? 'draining — no new allocations' : 'accepting allocations again'}`);
    return server;
  }

  /** Fleet-wide totals for the dashboard's RTC overview (spec §27). */
  async getFleetMetrics(): Promise<{
    servers: number;
    healthyServers: number;
    drainingServers: number;
    unhealthyServers: number;
    activeRooms: number;
    activeParticipants: number;
    capacity: number;
  }> {
    const [byStatus, totals] = await Promise.all([
      this.prisma.rtcServer.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.rtcServer.aggregate({
        _sum: { activeRooms: true, activeParticipants: true, capacity: true },
        _count: { _all: true },
      }),
    ]);

    const countFor = (status: RtcServerStatus) =>
      byStatus.find((row) => row.status === status)?._count._all ?? 0;

    return {
      servers: totals._count._all,
      healthyServers: countFor(RtcServerStatus.HEALTHY),
      drainingServers: countFor(RtcServerStatus.DRAINING),
      unhealthyServers: countFor(RtcServerStatus.UNHEALTHY),
      // Only counts rooms the fleet is actually *serving*. A room row in
      // Postgres with no assigned server has no live media session, so
      // counting it here overstates load.
      activeRooms: totals._sum.activeRooms ?? 0,
      activeParticipants: totals._sum.activeParticipants ?? 0,
      capacity: totals._sum.capacity ?? 0,
    };
  }
}
