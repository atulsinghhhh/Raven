import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { TooManyRequestsError } from '../errors/app-error';
import { RedisService } from '../redis/redis.service';
import { RATE_LIMIT_KEY } from './rate-limit.decorator';

/**
 * Fixed-window counter in Redis: INCR + EXPIRE-on-first-hit. Keyed by
 * client IP, not by authenticated identity — this guard also protects
 * pre-auth routes (login, register) where no identity exists yet.
 * Good enough to blunt credential-stuffing/brute-force/spam-signup abuse;
 * not a distributed, per-tenant rate-limiting platform (see Phase 14+
 * for anything beyond this).
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
