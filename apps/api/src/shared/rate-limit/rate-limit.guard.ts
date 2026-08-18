import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { TooManyRequestsError } from '../errors/app-error';
import { RedisService } from '../redis/redis.service';
import { RATE_LIMIT_KEY } from './rate-limit.decorator';

/**
 * Fixed-window counter in Redis: INCR, then EXPIRE on the first hit.
 * Keyed by IP rather than identity since this also has to cover pre-auth
 * routes like login/register where there's no identity yet. Enough to
 * blunt credential stuffing and spam signups — not a real multi-tenant
 * rate-limiting system.
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
    const redisKey = `ratelimit:${routeKey}:${request.ip ?? 'unknown'}`;

    const count = await this.redisService.client.incr(redisKey);
    if (count === 1) {
      await this.redisService.client.expire(redisKey, windowSeconds);
    }

    if (count > limit) {
      throw new TooManyRequestsError();
    }

    return true;
  }
}
