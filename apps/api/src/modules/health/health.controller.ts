import { Controller, Get, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { PrismaService } from '../../shared/database/prisma.service';
import { RedisService } from '../../shared/redis/redis.service';
import { SignalingGateway } from '../signaling/gateway/signaling.gateway';
import { RtcServerRegistryService } from '../rtc-servers/rtc-server-registry.service';
import { checkSfuHttp, checkStunBinding } from './dependency-checks.util';

type DependencyStatus = 'up' | 'down';

/**
 * Ceiling on any single dependency probe. Matches the SFU and STUN checks'
 * own timeouts, so every probe is bounded the same way and the endpoint's
 * worst-case response time stays predictable.
 */
const DEPENDENCY_CHECK_TIMEOUT_MS = 2000;

interface ReadinessResponse {
  status: 'ok' | 'degraded';
  dependencies: {
    database: DependencyStatus;
    redis: DependencyStatus;
    /** The media server behind Livqeno's RTC plane. Not named after whichever one it happens to be today. */
    sfu: DependencyStatus;
    turn: DependencyStatus;
  };
  signaling: {
    activeConnections: number;
    activeRooms: number;
    activeParticipants: number;
  };
}

// Reports up or down per dependency and nothing else. No connection
// strings, hostnames, versions or error messages. This is usually
// unauthenticated, since load balancers and orchestrators hit it, so it
// can't be leaking infra details.
@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly signalingGateway: SignalingGateway,
    private readonly configService: ConfigService,
    private readonly rtcServers: RtcServerRegistryService,
  ) {}

  /**
   * Liveness: can this process answer at all?
   *
   * Makes no dependency calls, on purpose. A database, Redis or SFU outage
   * must not let an orchestrator decide the *process* is broken and restart
   * it, because that just swaps a healthy pod that can't reach a dependency
   * for another healthy pod that also can't reach it.
   *
   * If this handler runs at all, the event loop isn't wedged. Which is the
   * one thing liveness is actually meant to answer.
   */
  @Get('live')
  @ApiOperation({ summary: 'Liveness probe — no dependency calls, unauthenticated' })
  @ApiResponse({ status: 200, description: 'The process is able to handle requests' })
  liveness(@Res() res: Response): void {
    res.status(200).json({ status: 'ok' });
  }

  /**
   * Readiness: should traffic be routed to this instance right now?
   *
   * This is the dependency-probing check that used to be all `GET /health`
   * did. It lives under its own path so an orchestrator can stop routing to
   * a degraded instance without restarting it. Those are materially
   * different actions.
   */
  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe — checks dependencies, unauthenticated' })
  @ApiResponse({
    status: 200,
    description: 'All dependencies reachable',
    schema: {
      example: {
        status: 'ok',
        dependencies: { database: 'up', redis: 'up', sfu: 'up', turn: 'up' },
        signaling: { activeConnections: 2, activeRooms: 1, activeParticipants: 2 },
      },
    },
  })
  @ApiResponse({
    status: 503,
    description: 'At least one dependency is unreachable',
    schema: {
      example: { status: 'degraded', dependencies: { database: 'up', redis: 'down', sfu: 'up', turn: 'up' } },
    },
  })
  async readiness(@Res() res: Response): Promise<void> {
    const payload = await this.buildReadinessResponse();
    res.status(payload.status === 'ok' ? 200 : 503).json(payload);
  }

  /**
   * An alias of `/health/ready`.
   *
   * This was the only health path before the liveness/readiness split, and
   * existing dashboards, scripts and already-configured load balancers
   * shouldn't have to change on the day that split ships.
   */
  @Get()
  @ApiOperation({ summary: 'Alias of /health/ready, kept for backward compatibility — unauthenticated' })
  async check(@Res() res: Response): Promise<void> {
    await this.readiness(res);
  }

  private async buildReadinessResponse(): Promise<ReadinessResponse> {
    const [database, redis, sfu, turn] = await Promise.all([
      this.checkDependency(() => this.prisma.ping()),
      this.checkDependency(() => this.redis.ping()),
      this.checkDependency(async () => {
        // Two things have to be true for RTC to work, and this checks both:
        // the fleet registry holds a healthy node, and that node is actually
        // reachable from this process.
        //
        // Registry state on its own reports "up" for a node that heartbeats
        // happily but sits behind a broken route from here. A bare HTTP
        // probe on its own needs a hardcoded address, which is the very
        // thing the registry exists to avoid.
        //
        // Scoped to the region this instance allocates in, and tried in
        // order rather than one-node-and-done. Probing the whole fleet
        // meant readiness depended on nodes in other networks: a healthy
        // node in another region advertises an address private to that
        // network, so the probe failed and the instance took itself out of
        // rotation over something it was never going to allocate anyway.
        const region = this.configService.get<string>('sfu.defaultRegion')!;
        const candidates = await this.rtcServers.listHealthyForProbe(region);
        if (candidates.length === 0) throw new Error('no healthy rtc server registered');
        // internalUrl, not publicHost. This check runs inside the
        // deployment's network, not from a real client's vantage point.
        for (const candidate of candidates) {
          if (await checkSfuHttp(candidate.internalUrl)) return;
        }
        throw new Error('unreachable');
      }),
      this.checkDependency(async () => {
        const ok = await checkStunBinding(
          this.configService.get<string>('turn.internalHost')!,
          this.configService.get<number>('turn.port')!,
        );
        if (!ok) throw new Error('unreachable');
      }),
    ]);

    const status: ReadinessResponse['status'] =
      database === 'up' && redis === 'up' && sfu === 'up' && turn === 'up' ? 'ok' : 'degraded';

    // Aggregate counts only, never room or participant IDs. Same reasoning
    // as the class-level comment above.
    return {
      status,
      dependencies: { database, redis, sfu, turn },
      signaling: this.signalingGateway.getMetrics(),
    };
  }

  /**
   * Runs one probe and maps any failure, taking too long included, to
   * `down`.
   *
   * The timeout is the important bit. A dependency that's *hung* rather than
   * *down*, whether that's a network partition, a paused container, or a
   * server too busy to answer, accepts the connection and then never
   * replies. An unbounded probe waits forever.
   *
   * And a health endpoint that hangs is strictly worse than one reporting a
   * fault. An orchestrator can act on "down"; a request that never returns
   * just looks like the whole API is wedged.
   *
   * The SFU and STUN probes already bound themselves. This covers the
   * database and Redis ones too, so the endpoint answers within a known time
   * whichever dependency is misbehaving.
   */
  private async checkDependency(fn: () => Promise<void>): Promise<DependencyStatus> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        fn(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), DEPENDENCY_CHECK_TIMEOUT_MS);
        }),
      ]);
      return 'up';
    } catch {
      return 'down';
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
