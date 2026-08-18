import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  public client!: Redis;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const url = this.configService.get<string>('redis.url');
    this.client = new Redis(url!, {
      lazyConnect: false,
      maxRetriesPerRequest: 3,
      // Bounds how long a single command may wait. Without this, a Redis
      // that is *hung* rather than *down* — a network partition, a paused
      // container, a server too busy to answer — accepts the TCP
      // connection and then never replies, and ioredis waits forever.
      //
      // That distinction matters a lot for chat: every caller here is
      // written to fail open when Redis errors (rate limits, presence,
      // idempotency caching, fan-out), but a hang produces no error to
      // catch, so a partitioned Redis would hang message sends instead of
      // degrading them. A timeout turns the hang into the error those
      // handlers already deal with correctly.
      //
      // 2s is ~1000x a normal command here; anything slower is a fault,
      // not slowness.
      commandTimeout: this.configService.get<number>('redis.commandTimeoutMs') ?? 2000,
    });

    this.client.on('error', (err) => {
      this.logger.error(`Redis connection error: ${err.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }

  /** Used by the health module — throws if Redis is unreachable. */
  async ping(): Promise<void> {
    const reply = await this.client.ping();
    if (reply !== 'PONG') {
      throw new Error(`Unexpected Redis PING reply: ${reply}`);
    }
  }
}
