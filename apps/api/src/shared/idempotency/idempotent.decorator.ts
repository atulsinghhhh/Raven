import { SetMetadata } from '@nestjs/common';

export const IDEMPOTENT_KEY = 'idempotent';

/** How long a replayed Idempotency-Key still returns the cached response, by default. */
export const DEFAULT_IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

/**
 * Opts a mutating route into Idempotency-Key deduplication
 * (IdempotencyInterceptor, used alongside `@UseInterceptors`) — the same
 * opt-in pairing RateLimitGuard/`@RateLimit()` already use, and for the
 * same reason: treating every route as idempotent by default would be a
 * silent behavior change for ones never designed to tolerate a replay.
 */
export const Idempotent = (ttlSeconds: number = DEFAULT_IDEMPOTENCY_TTL_SECONDS) =>
  SetMetadata(IDEMPOTENT_KEY, ttlSeconds);
