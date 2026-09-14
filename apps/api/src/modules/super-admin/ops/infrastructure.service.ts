import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RtcServer } from '../../../generated/prisma/client';
import { PrismaService } from '../../../shared/database/prisma.service';
import { RedisService } from '../../../shared/redis/redis.service';
import { checkSfuHttp, checkStunBinding } from '../../health/dependency-checks.util';
import { RtcServerRegistryService } from '../../rtc-servers/rtc-server-registry.service';

type DependencyStatus = 'up' | 'down';

export interface InfrastructureResponse {
  generatedAt: string;
  dependencies: {
    api: 'up';
    database: DependencyStatus;
    redis: DependencyStatus;
    sfu: DependencyStatus;
    turn: DependencyStatus;
  };
  fleet: {
    servers: number;
    healthyServers: number;
    drainingServers: number;
    unhealthyServers: number;
    activeRooms: number;
    activeParticipants: number;
    capacity: number;
  };
  /**
   * One row per registered RTC node. Same shape the existing
   * `GET /v1/rtc/servers` dashboard endpoint already returns (including
   * `internalUrl`) — this doesn't expose anything new, it just surfaces
   * the same ordinary fleet-inventory data to the ops console.
   */
  nodes: RtcServer[];
}

const DEPENDENCY_CHECK_TIMEOUT_MS = 2000;

/**
 * Infrastructure surface (spec §17). Reuses the exact same lower-level
 * probes `HealthController`/`OverviewService` already run
 * (`PrismaService.ping`, `RedisService.ping`, `checkSfuHttp`/
 * `checkStunBinding` against the registered RTC fleet) rather than
 * re-implementing pings here — this is a third caller of the same
 * dependency-check utilities, not a new health-check system.
 */
@Injectable()
export class InfrastructureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly configService: ConfigService,
    private readonly rtcServers: RtcServerRegistryService,
  ) {}

  async getInfrastructure(): Promise<InfrastructureResponse> {
    const now = new Date();

    const [database, redis, sfu, turn, fleet, nodes] = await Promise.all([
      this.probe(() => this.prisma.ping()),
      this.probe(() => this.redis.ping()),
      this.probe(async () => {
        const region = this.configService.get<string>('sfu.defaultRegion')!;
        const candidates = await this.rtcServers.listHealthyForProbe(region);
        if (candidates.length === 0) throw new Error('no healthy rtc server registered');
        for (const candidate of candidates) {
          if (await checkSfuHttp(candidate.internalUrl)) return;
        }
        throw new Error('unreachable');
      }),
      this.probe(async () => {
        const ok = await checkStunBinding(
          this.configService.get<string>('turn.internalHost')!,
          this.configService.get<number>('turn.port')!,
        );
        if (!ok) throw new Error('unreachable');
      }),
      this.rtcServers.getFleetMetrics(),
      this.rtcServers.list(),
    ]);

    return {
      generatedAt: now.toISOString(),
      dependencies: { api: 'up', database, redis, sfu, turn },
      fleet,
      nodes,
    };
  }

  private async probe(fn: () => Promise<void>): Promise<DependencyStatus> {
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
