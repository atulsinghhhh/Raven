import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  public readonly client: Redis;

  /**
   * Built here, not in `onModuleInit()`. Nest's DI container guarantees a
   * dependency's *constructor* has finished before any consumer's
   * constructor runs (`ChatEventsService` et al. take `RedisService` as a
   * constructor param), but it makes no such guarantee across unrelated
   * modules for the separate `onModuleInit` lifecycle phase. That gap was
   * latent until adding a second import path to a consuming module
   * (Live Streaming importing ChatModule alongside AppModule already
   * doing so) reordered hook firing enough to expose it:
   * `ChatEventsService.onModuleInit()` ran before this service's own
   * `onModuleInit()` had, so `this.client` was still undefined.
   * Constructing the client synchronously in the constructor removes the
   * ordering dependency entirely, for every current and future consumer;
   * not a workaround scoped to the module that happened to trip it.
   */
  constructor(private readonly configService: ConfigService) {
    const url = this.configService.get<string>('redis.url');
    this.client = new Redis(url!, {
      lazyConnect: false,
      maxRetriesPerRequest: 3,
      // Bounds how long a single command may wait. Without this, a Redis
      // that is *hung*, not *down*: a network partition, a paused
      // container, a server too busy to answer: accepts the TCP
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

  /** Used by the health module: throws if Redis is unreachable. */
  async ping(): Promise<void> {
    const reply = await this.client.ping();
    if (reply !== 'PONG') {
      throw new Error(`Unexpected Redis PING reply: ${reply}`);
    }
  }
}
