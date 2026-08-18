import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../shared/database/prisma.service';
import { RedisService } from '../../../shared/redis/redis.service';
import { RedisKeys } from '../chat.constants';

const LOCK_TTL_SECONDS = 300;
/** Deleted in chunks so a first sweep over a large backlog doesn't hold one enormous transaction. */
const DELETE_BATCH_SIZE = 1000;

/**
 * Message retention (spec §41). The storage model supports it, and this
 * enforces it — but only where a retention window has actually been
 * configured. `CHAT_RETENTION_DAYS=0` (the default) means keep forever,
 * and this sweeper does nothing at all in that case.
 *
 * Per-conversation `retentionDays` overrides the project default, which
 * is what makes plan-tier retention (7/30/90/365 days) a configuration
 * change rather than a schema change later.
 *
 * Same interval-plus-Redis-lock shape as the observability RetentionService
 * and the webhook worker — no scheduler dependency, and safe to run on
 * every instance in a fleet.
 */
@Injectable()
export class ChatRetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatRetentionService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    const intervalMs = this.configService.get<number>('chat.retentionSweepIntervalMs')!;
    this.timer = setInterval(() => void this.sweep(), intervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Returns how many messages were removed. Exposed so tests can drive a sweep directly. */
  async sweep(): Promise<number> {
    if (!(await this.acquireLock())) {
      return 0;
    }

    let removed = 0;
    try {
      removed += await this.sweepPerConversationOverrides();
      removed += await this.sweepProjectDefault();
    } catch (err) {
      this.logger.error(`chat retention sweep failed: ${(err as Error).message}`);
    }

    if (removed > 0) {
      this.logger.log(`chat retention removed ${removed} expired messages`);
    }
    return removed;
  }

  /** Conversations with an explicit window, each swept against its own cutoff. */
  private async sweepPerConversationOverrides(): Promise<number> {
    const conversations = await this.prisma.conversation.findMany({
      where: { retentionDays: { not: null } },
      select: { id: true, retentionDays: true },
    });

    let removed = 0;
    for (const conversation of conversations) {
      const cutoff = daysAgo(conversation.retentionDays!);
      removed += await this.deleteOlderThan({ conversationId: conversation.id, createdAt: { lt: cutoff } });
    }
    return removed;
  }

  /** Everything else falls back to the deployment-wide default, if one is set. */
  private async sweepProjectDefault(): Promise<number> {
    const retentionDays = this.configService.get<number>('chat.retentionDays')!;
    if (!retentionDays || retentionDays <= 0) {
      return 0;
    }

    const cutoff = daysAgo(retentionDays);
    return this.deleteOlderThan({
      createdAt: { lt: cutoff },
      conversation: { retentionDays: null },
    });
  }

  private async deleteOlderThan(where: Record<string, unknown>): Promise<number> {
    let total = 0;
    for (;;) {
      // Select ids first, then delete by id: `deleteMany` has no LIMIT, so
      // this is how the work stays batched.
      const batch = await this.prisma.message.findMany({
        where,
        select: { id: true },
        take: DELETE_BATCH_SIZE,
      });
      if (batch.length === 0) {
        return total;
      }
      // Reactions, read-state links, and attachment rows follow via the
      // schema's cascade/SetNull rules — nothing is orphaned.
      const result = await this.prisma.message.deleteMany({
        where: { id: { in: batch.map((row) => row.id) } },
      });
      total += result.count;
      if (batch.length < DELETE_BATCH_SIZE) {
        return total;
      }
    }
  }

  private async acquireLock(): Promise<boolean> {
    try {
      const acquired = await this.redisService.client.set(
        RedisKeys.chatRetentionLock,
        '1',
        'EX',
        LOCK_TTL_SECONDS,
        'NX',
      );
      return acquired === 'OK';
    } catch {
      // Without coordination, skip. A delayed sweep is harmless; several
      // instances deleting concurrently is not worth the risk.
      return false;
    }
  }
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}
