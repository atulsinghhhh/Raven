import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { TooManyRequestsError } from '../errors/app-error';
import { actorFor } from '../http/request-actor.util';
import { RedisService } from '../redis/redis.service';
import { RATE_LIMIT_KEY } from './rate-limit.decorator';

/**
 * Fixed-window counter in Redis: INCR, then EXPIRE on the first hit.
 *
 * Keyed by the most specific identity the request actually carries, in
 * this order:
 *
 *   1. API key public id (`ApiKeyAuthGuard` sets `apiProjectId` —
 *      a key belongs to exactly one project and environment, so this is
 *      already scoped as tightly as an IP address never could be)
 *   2. JWT user id (`JwtAuthGuard`/passport sets `request.user`)
 *   3. Client IP — the only signal available pre-auth (login, register),
 *      and the reason this guard cannot key on identity alone: a route
 *      with no identity yet still needs a limiter.
 *
 * IP-only keying has two concrete failure modes, both real rather than
 * hypothetical: every legitimate user behind one corporate NAT shares a
 * single bucket, and a single authenticated actor can evade any limit
 * meant to cap them just by rotating IPs. Keying on identity when one
 * exists fixes both, since it follows the actor rather than their network
 * path.
 *
 * Not composed with IP even when an identity is present — an
 * authenticated abuser rotating IPs is still one identity and should
 * still be capped as one; adding IP back in would only reopen the second
 * failure mode above for exactly the requests where identity is known.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const limit = this.reflector.get<number | undefined>(RATE_LIMIT_KEY, context.getHandler());
    if (!limit) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const windowSeconds = this.configService.get<number>('rateLimit.windowSeconds')!;
    const routeKey = `${context.getClass().name}.${context.getHandler().name}`;
    const redisKey = `ratelimit:${routeKey}:${actorFor(request)}`;

    const count = await this.redisService.client.incr(redisKey);
    if (count === 1) {
      await this.redisService.client.expire(redisKey, windowSeconds);
    }

    if (count > limit) {
      const ttl = await this.redisService.client.ttl(redisKey).catch(() => windowSeconds);
      throw new TooManyRequestsError(undefined, { retryAfterSeconds: ttl > 0 ? ttl : windowSeconds });
    }

    return true;
  }
}
