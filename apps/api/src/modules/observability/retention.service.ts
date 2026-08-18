import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../shared/database/prisma.service';

export interface RetentionSweepResult {
  connectionsDeleted: number;
  errorsDeleted: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Enforces the retention policy from Phase 9 spec §29 with a plain
 * `setInterval` (same pattern as `SignalingGateway`'s heartbeat) rather
 * than a new cron dependency. Deleting a `Connection` cascades its
 * `ConnectionEvent` rows and nulls out any `ErrorEvent.connectionId`
 * that pointed at it (see schema.prisma) — an error can outlive the
 * connection it happened on, up to its own (longer) retention window.
 */
@Injectable()
export class RetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RetentionService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    const intervalMs = this.configService.get<number>('observability.retentionSweepIntervalMs')!;
    this.timer = setInterval(() => void this.runSweep(), intervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(): Promise<RetentionSweepResult> {
    const connectionCutoff = new Date(
      Date.now() - this.configService.get<number>('observability.connectionRetentionDays')! * DAY_MS,
    );
    const errorCutoff = new Date(
      Date.now() - this.configService.get<number>('observability.errorRetentionDays')! * DAY_MS,
    );

    const [connections, errors] = await Promise.all([
      this.prisma.connection.deleteMany({ where: { createdAt: { lt: connectionCutoff } } }),
      this.prisma.errorEvent.deleteMany({ where: { timestamp: { lt: errorCutoff } } }),
    ]);

    return { connectionsDeleted: connections.count, errorsDeleted: errors.count };
  }

  private async runSweep(): Promise<void> {
    try {
      const result = await this.sweep();
      if (result.connectionsDeleted > 0 || result.errorsDeleted > 0) {
        this.logger.log(
          `retention sweep: removed ${result.connectionsDeleted} connections, ${result.errorsDeleted} errors`,
        );
      }
    } catch (error) {
      this.logger.error(`retention sweep failed: ${(error as Error).message}`);
    }
  }
}
