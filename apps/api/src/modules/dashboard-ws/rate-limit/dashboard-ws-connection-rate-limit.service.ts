import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../../shared/redis/redis.service';

/**
 * Protects the dashboard WebSocket upgrade/connect step, keyed by client
 * IP. Same fixed-window INCR+EXPIRE approach as signaling's
 * ConnectionRateLimitService and the HTTP API's RateLimitGuard. Redis-
 * backed, not in-memory, for the same reason signaling's is: it has to
 * survive across reconnects, not just across messages on one connection.
 */
@Injectable()
export class DashboardWsConnectionRateLimitService {
  constructor(
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {}

  async isAllowed(clientIp: string): Promise<boolean> {
    const limit = this.configService.get<number>('dashboardWs.maxConnectionsPerWindow')!;
    const windowSeconds = this.configService.get<number>('rateLimit.windowSeconds')!;
    const key = `ratelimit:dashboard-ws:connect:${clientIp}`;

    const count = await this.redisService.client.incr(key);
    if (count === 1) {
      await this.redisService.client.expire(key, windowSeconds);
    }

    return count <= limit;
  }
}
