import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../../shared/redis/redis.service';

/**
 * Protects the WebSocket upgrade/connect step, keyed by client IP. Same
 * fixed-window INCR+EXPIRE approach as the HTTP API's RateLimitGuard
 * (shared/rate-limit/) — reusing Redis here (rather than in-memory) is
 * deliberate: an attacker flooding connections could otherwise just
 * reconnect to reset an in-memory counter tied to a specific process,
 * and this is the one signaling limit that genuinely needs to survive
 * across reconnect attempts, not just across messages on one connection.
 */
@Injectable()
export class ConnectionRateLimitService {
  constructor(
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {}

  async isAllowed(clientIp: string): Promise<boolean> {
    const limit = this.configService.get<number>('signaling.maxConnectionsPerWindow')!;
    const windowSeconds = this.configService.get<number>('rateLimit.windowSeconds')!;
    const key = `ratelimit:signaling:connect:${clientIp}`;

    const count = await this.redisService.client.incr(key);
    if (count === 1) {
      await this.redisService.client.expire(key, windowSeconds);
    }

    return count <= limit;
  }
}
