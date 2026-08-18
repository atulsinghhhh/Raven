import { Controller, Get, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { PrismaService } from '../../shared/database/prisma.service';
import { RedisService } from '../../shared/redis/redis.service';
import { SignalingGateway } from '../signaling/gateway/signaling.gateway';
import { checkLiveKitHttp, checkStunBinding } from './dependency-checks.util';

type DependencyStatus = 'up' | 'down';

interface HealthResponse {
  status: 'ok' | 'degraded';
  dependencies: {
    database: DependencyStatus;
    redis: DependencyStatus;
    livekit: DependencyStatus;
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
  ) {}

  @Get()
  @ApiOperation({ summary: 'Liveness/readiness check — unauthenticated' })
  @ApiResponse({
    status: 200,
    description: 'All dependencies reachable',
    schema: {
      example: {
        status: 'ok',
        dependencies: { database: 'up', redis: 'up', livekit: 'up', turn: 'up' },
        signaling: { activeConnections: 2, activeRooms: 1, activeParticipants: 2 },
      },
    },
  })
  @ApiResponse({
    status: 503,
    description: 'At least one dependency is unreachable',
    schema: {
      example: { status: 'degraded', dependencies: { database: 'up', redis: 'down', livekit: 'up', turn: 'up' } },
    },
  })
  async check(@Res() res: Response): Promise<void> {
    const [database, redis, livekit, turn] = await Promise.all([
      this.checkDependency(() => this.prisma.ping()),
      this.checkDependency(() => this.redis.ping()),
      this.checkDependency(async () => {
        // internalUrl, not url — this check runs inside the Docker
        // network, not from a real client's vantage point.
        const ok = await checkLiveKitHttp(this.configService.get<string>('livekit.internalUrl')!);
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

    const status: HealthResponse['status'] =
      database === 'up' && redis === 'up' && livekit === 'up' && turn === 'up' ? 'ok' : 'degraded';

    // Aggregate counts only, never room/participant IDs — same reasoning
    // as the class-level comment above.
    res.status(status === 'ok' ? 200 : 503).json({
      status,
      dependencies: { database, redis, livekit, turn },
      signaling: this.signalingGateway.getMetrics(),
    } satisfies HealthResponse);
  }

  private async checkDependency(fn: () => Promise<void>): Promise<DependencyStatus> {
    try {
      await fn();
      return 'up';
    } catch {
      return 'down';
    }
  }
}
