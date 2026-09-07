import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RtcServer, RtcServerStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotFoundError } from '../../shared/errors/app-error';
import { RavenErrorCode } from '../../shared/errors/error-codes';
import { RegisterRtcServerDto } from './dto/register-rtc-server.dto';
import { RtcServerHeartbeatDto } from './dto/rtc-server-heartbeat.dto';

/**
 * How often stale nodes are swept. Independent of the heartbeat timeout:
 * the timeout decides *whether* a node is late, this decides how quickly
 * we notice. A sweep this frequent means a dead node stops receiving
 * allocations within roughly one timeout plus one sweep.
 */
const STALE_SWEEP_INTERVAL_MS = 10_000;

/**
 * The fleet's record of which RTC servers exist and how loaded they are
 * (spec §23, §26).
 *
 * Rows are created by the nodes themselves, on boot, and refreshed by
 * their heartbeats — the control plane never provisions them. A node
 * re-registering under a name it already used reclaims that row rather
 * than adding a second, so a restart or a redeploy doesn't accumulate
 * phantom entries.
 *
 * Everything here is a snapshot as of the last heartbeat. That is stated
 * rather than hidden, because an allocator reading these numbers is
 * always reading something slightly old, and a dashboard showing them
 * needs to say so (see `lastHeartbeatAt`).
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
    // Every API instance runs this. The sweep is idempotent — it only ever
    // moves a node whose heartbeat is already past the deadline into
    // UNHEALTHY — so N instances racing costs N writes on the transition
    // and nothing after that. Cheaper than electing a leader for it.
    this.sweepTimer = setInterval(() => void this.markStaleServersUnhealthy(), STALE_SWEEP_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
    }
  }

  /**
   * Called by an SFU when it boots. Idempotent by `name`: a node that
   * restarts reclaims its row, keeping its history and its id stable for
   * anything that referenced it (a room's `rtcServerId`, a log line, a
   * dashboard link).
   *
   * Registration resets the load counters to zero rather than trusting
   * whatever the dead process last reported — a freshly booted SFU is
   * serving nothing, whatever the old row said.
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
   * A heartbeat from a node marked UNHEALTHY promotes it back to HEALTHY —
   * that is the recovery path spec §26 asks for, and it is why the sweep
   * marks nodes unhealthy rather than deleting them. A node an operator
   * has set to DRAINING stays draining: only an explicit undrain brings it
   * back, since otherwise the next heartbeat would silently undo the
   * operator's decision.
   */
  async heartbeat(name: string, dto: RtcServerHeartbeatDto): Promise<RtcServer> {
    const existing = await this.prisma.rtcServer.findUnique({ where: { name } });
    if (!existing) {
      // Tell the node to register rather than silently creating a row from
      // a heartbeat: a heartbeat doesn't carry region/host/capacity, so the
      // row it created would be unusable for allocation.
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
   * Existing rooms on those nodes are deliberately left alone. Spec §26 is
   * explicit that an unhealthy SFU must not have its active rooms killed
   * without recovery logic — and a missed heartbeat is often a paused
   * container or a brief network blip, not a dead process. What changes is
   * only that the node stops being chosen for *new* rooms.
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
      // A sweep that can't reach the database must not take the API down
      // with it; the next tick tries again.
      this.logger.error(`stale-server sweep failed: ${(err as Error).message}`);
      return 0;
    }
  }

  /** Every server in the fleet, newest registration last. For the dashboard and CLI. */
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
   * The least-loaded healthy node, so a probe does not repeatedly hit the
   * busiest one. `null` when the fleet has nothing healthy registered,
   * which is itself the answer readiness needs — there is nowhere to put
   * a new room.
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
   * The operator-facing half of spec §26: a node being upgraded or
   * investigated should stop taking new rooms and let its existing ones
   * drain naturally, rather than being killed mid-call.
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
      // Only counts rooms the fleet is *serving*. A room row in Postgres
      // with no assigned server has no live media session, so counting it
      // here would overstate load.
      activeRooms: totals._sum.activeRooms ?? 0,
      activeParticipants: totals._sum.activeParticipants ?? 0,
      capacity: totals._sum.capacity ?? 0,
    };
  }
}
