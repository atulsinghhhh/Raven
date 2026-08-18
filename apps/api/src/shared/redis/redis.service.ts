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
