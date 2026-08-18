import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'rateLimit';

/**
 * Caps a route to `limit` requests per window (RATE_LIMIT_WINDOW_SECONDS).
 * See RateLimitGuard for how the budget is keyed — by API key, then by
 * user, then by IP only as a last resort. Kept intentionally simple
 * beyond that: one global window, no per-tier limits — this is not a
 * distributed rate-limiting platform.
 */
export const RateLimit = (limit: number) => SetMetadata(RATE_LIMIT_KEY, limit);
