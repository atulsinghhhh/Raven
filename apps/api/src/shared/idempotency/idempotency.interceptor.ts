import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'crypto';
import { Request } from 'express';
import { Observable, firstValueFrom, of } from 'rxjs';
import { ConflictError } from '../errors/app-error';
import { actorFor } from '../http/request-actor.util';
import { RedisService } from '../redis/redis.service';
import { IDEMPOTENT_KEY } from './idempotent.decorator';

const IDEMPOTENCY_HEADER = 'idempotency-key';
/** An unbounded client-supplied string has no business becoming a Redis key. */
const MAX_KEY_LENGTH = 255;

interface CachedResponse {
  bodyHash: string;
  body: unknown;
}

/**
 * Generalizes the dedup pattern already proven twice in this codebase —
 * chat's `Message.clientMessageId` and webhooks' `(eventId, endpointId)`
 * unique constraint — onto REST mutations that have no dedicated column
 * of their own to lean on: a client-supplied `Idempotency-Key` header,
 * scoped per route and per caller (`actorFor`, the same identity
 * RateLimitGuard keys on), gets its first response cached in Redis; a
 * retry with the same key inside the TTL replays that response instead
 * of re-executing the handler.
 *
 * This is a best-effort fast path, not a lock — same honesty as the
 * comment on `RedisKeys.idempotency` in chat.constants.ts ("fast-path
 * duplicate detection ahead of the DB's unique constraint"). Two
 * requests carrying the same key that arrive concurrently, before either
 * has cached a response yet, can both execute the handler. Routes where
 * that would be a real problem need their own DB-level uniqueness
 * constraint, the same way chat and webhooks already have theirs — this
 * layer catches the far more common case (a client retrying after a
 * timeout, one request at a time), not the concurrent race.
 *
 * Opt-in via `@Idempotent()` + `@UseInterceptors(IdempotencyInterceptor)`
 * — see that decorator for why this isn't applied globally. Fails open
 * on Redis errors, same posture as every other Redis-backed concern here.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly redisService: RedisService,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const ttlSeconds = this.reflector.get<number | undefined>(IDEMPOTENT_KEY, context.getHandler());
    if (!ttlSeconds || context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const key = this.extractKey(request);
    if (!key) {
      // No key supplied, or a client sent something we won't put in a
      // Redis key — proceed without dedup rather than reject a request
      // over what is an optional header.
      return next.handle();
    }

    const routeKey = `${context.getClass().name}.${context.getHandler().name}`;
    const bodyHash = this.hashBody(request.body);
    const redisKey = `raven:idempotency:${routeKey}:${actorFor(request)}:${key}`;

    const cached = await this.readCached(redisKey);
    if (cached) {
      if (cached.bodyHash !== bodyHash) {
        throw new ConflictError('This Idempotency-Key was already used with a different request body');
      }
      return of(cached.body);
    }

    // Not cached (or Redis was unreachable for the read above) — run the
    // handler for real. A thrown error here propagates untouched: only a
    // successful response gets cached, so a client is free to retry a
    // genuinely failed attempt with the same key.
    const response = await firstValueFrom(next.handle());

    await this.writeCached(redisKey, { bodyHash, body: response }, ttlSeconds);
    return of(response);
  }

  private extractKey(request: Request): string | undefined {
    const raw = request.headers[IDEMPOTENCY_HEADER];
    const key = Array.isArray(raw) ? raw[0] : raw;
    if (!key || key.length === 0 || key.length > MAX_KEY_LENGTH) {
      return undefined;
    }
    return key;
  }

  private hashBody(body: unknown): string {
    return createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');
  }

  private async readCached(redisKey: string): Promise<CachedResponse | undefined> {
    try {
      const raw = await this.redisService.client.get(redisKey);
      return raw ? (JSON.parse(raw) as CachedResponse) : undefined;
    } catch {
      return undefined;
    }
  }

  private async writeCached(redisKey: string, value: CachedResponse, ttlSeconds: number): Promise<void> {
    try {
      // NX: if two concurrent requests both raced past the read above,
      // whichever finishes first wins the cached slot — the second
      // doesn't clobber it with its own (identical, since both hashed
      // the same body) response.
      await this.redisService.client.set(redisKey, JSON.stringify(value), 'EX', ttlSeconds, 'NX');
    } catch {
      // A caller retrying within the window just re-executes the
      // handler — not ideal, but not a reason to fail this request.
    }
  }
}
