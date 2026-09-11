import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../../shared/redis/redis.service';
import { RedisKeys } from '../chat.constants';

/** Counters the dashboard reads back. Kept short on purpose (spec §47: "do not build excessive analytics"). */
export type ChatCounter =
  | 'messages_sent'
  | 'messages_failed'
  | 'messages_fanned_out'
  | 'connections_opened'
  | 'connections_failed'
  | 'reconnects'
  | 'rate_limited';

/** Latency stages a message passes through (spec §48). */
export type ChatLatencyStage = 'persist' | 'fanout' | 'end_to_end';

const BUCKET_SECONDS = 60;
// Two hours of per-minute buckets. Enough for the dashboard's 15m/1h
// windows without Redis accumulating counters nobody reads.
const BUCKET_TTL_SECONDS = 2 * 60 * 60;

/**
 * Rolling per-minute counters in Redis (spec §47/§48). Deliberately not
 * Postgres: these are high-frequency, low-value-per-row, and expiring
 * them is the whole point. Nothing here is on the message delivery path;
 * every method fires and forgets, and a Redis failure costs a log line,
 * never a dropped message (spec §48: "do not block message delivery on
 * analytics").
 *
 * Latency is recorded as (sum, count) pairs so an average can be read
 * back cheaply. No histograms/percentiles in this phase: that's what a
 * real metrics backend is for, and claiming p99s from a pair of counters
 * would be dishonest.
 */
@Injectable()
export class ChatMetricsService {
  private readonly logger = new Logger(ChatMetricsService.name);

  constructor(private readonly redisService: RedisService) {}

  increment(projectId: string, counter: ChatCounter, by = 1): void {
    void this.write(projectId, counter, by);
  }

  recordLatency(projectId: string, stage: ChatLatencyStage, ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) {
      return;
    }
    void this.write(projectId, `latency_${stage}_sum`, Math.round(ms));
    void this.write(projectId, `latency_${stage}_count`, 1);
  }

  /**
   * Sums the last `minutes` buckets. Returns real zeros for a quiet
   * project instead of a fabricated number: same honesty rule the RTC
   * MetricsService follows.
   */
  async readCounter(projectId: string, metric: string, minutes: number): Promise<number> {
    const keys = this.recentBuckets(minutes).map((bucket) => RedisKeys.metricCounter(projectId, metric, bucket));
    if (keys.length === 0) return 0;

    try {
      const values = await this.redisService.client.mget(...keys);
      return values.reduce<number>((total, value) => total + (value ? Number(value) : 0), 0);
    } catch (err) {
      this.logger.warn(`chat metric read failed: ${(err as Error).message}`);
      return 0;
    }
  }

  /** Null when nothing was measured in the window: never a made-up average. */
  async readAverageLatency(projectId: string, stage: ChatLatencyStage, minutes: number): Promise<number | null> {
    const [sum, count] = await Promise.all([
      this.readCounter(projectId, `latency_${stage}_sum`, minutes),
      this.readCounter(projectId, `latency_${stage}_count`, minutes),
    ]);
    return count > 0 ? Math.round(sum / count) : null;
  }

  private async write(projectId: string, metric: string, by: number): Promise<void> {
    const key = RedisKeys.metricCounter(projectId, metric, currentBucket());
    try {
      await this.redisService.client.incrby(key, by);
      await this.redisService.client.expire(key, BUCKET_TTL_SECONDS);
    } catch (err) {
      this.logger.warn(`chat metric write failed (${metric}): ${(err as Error).message}`);
    }
  }

  private recentBuckets(minutes: number): string[] {
    const now = Math.floor(Date.now() / 1000 / BUCKET_SECONDS);
    const capped = Math.min(minutes, BUCKET_TTL_SECONDS / BUCKET_SECONDS);
    return Array.from({ length: capped }, (_unused, i) => String(now - i));
  }
}

function currentBucket(): string {
  return String(Math.floor(Date.now() / 1000 / BUCKET_SECONDS));
}
