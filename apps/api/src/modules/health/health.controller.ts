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
 * Upper bound on any single dependency probe. Matches the SFU/STUN
 * checks' own timeouts so every probe is bounded the same way and the
 * endpoint's worst-case response time is predictable.
 */
const DEPENDENCY_CHECK_TIMEOUT_MS = 2000;

interface ReadinessResponse {
  status: 'ok' | 'degraded';
  dependencies: {
    database: DependencyStatus;
    redis: DependencyStatus;
    /** The media server behind Raven's RTC plane — not named after whichever one it is today. */
    sfu: DependencyStatus;
    turn: DependencyStatus;
  };
  signaling: {
    activeConnections: number;
    activeRooms: number;
    activeParticipants: number;
  };
}

// Only reports up/down per dependency — no connection strings, hostnames,
// versions, or error messages. This is usually unauthenticated (load
// balancers/orchestrators hit it), so it can't leak infra details.
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
   * Liveness: "is this process able to answer at all". Deliberately makes
   * no dependency calls — a database/Redis/SFU outage must not cause
   * an orchestrator to conclude the *process* is broken and restart it,
   * which would just replace a healthy pod that can't reach a dependency
   * with another healthy pod that also can't reach that dependency. If
   * this handler runs at all, the event loop isn't wedged, which is the
   * one thing liveness is actually supposed to answer.
   */
  @Get('live')
  @ApiOperation({ summary: 'Liveness probe — no dependency calls, unauthenticated' })
  @ApiResponse({ status: 200, description: 'The process is able to handle requests' })
  liveness(@Res() res: Response): void {
    res.status(200).json({ status: 'ok' });
  }

  /**
   * Readiness: "should traffic be routed to this instance right now".
   * This is the dependency-probing check that used to be the only thing
   * `GET /health` did — kept under its own path so an orchestrator can
   * stop routing to a degraded instance (readiness) without restarting
   * it (liveness), which is a materially different action.
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
   * Kept as an alias of `/health/ready` — this was the only health path
   * before the liveness/readiness split, and existing dashboards/scripts
   * (and load balancers already configured against it) shouldn't have to
   * change on the same day this split ships.
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
        // Two things have to be true for RTC to work, and this checks
        // both: the fleet registry has a healthy node, and that node is
        // actually reachable from this process.
        //
        // Registry state alone would report "up" for a node that
        // heartbeats but sits behind a broken route from here; a bare HTTP
        // probe alone would need a hardcoded address, which the whole
        // registry exists to avoid.
        const server = await this.rtcServers.pickHealthyForProbe();
        if (!server) throw new Error('no healthy rtc server registered');
        // internalUrl, not publicHost — this check runs inside the
        // deployment's network, not from a real client's vantage point.
        const ok = await checkSfuHttp(server.internalUrl);
        if (!ok) throw new Error('unreachable');
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

    // Aggregate counts only, never room/participant IDs — same reasoning
    // as the class-level comment above.
    return {
      status,
      dependencies: { database, redis, sfu, turn },
      signaling: this.signalingGateway.getMetrics(),
    };
  }

  /**
   * Runs one probe and maps any failure — including taking too long — to
   * `down`.
   *
   * The timeout is the important part. A dependency that is *hung* rather
   * than *down* (a network partition, a paused container, a server too
   * busy to answer) accepts the connection and then never replies, and a
   * probe without a bound waits forever. A health endpoint that hangs is
   * strictly worse than one reporting a fault: an orchestrator can act on
   * "down", but a request that never returns just looks like the whole
   * API is wedged.
   *
   * The SFU and STUN probes already bound themselves; this covers the
   * database and Redis ones too, so the endpoint answers within a known
   * time no matter which dependency is misbehaving.
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
