import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'rateLimit';

/**
 * Caps a route to `limit` requests per window (RATE_LIMIT_WINDOW_SECONDS),
 * keyed by client IP. Kept intentionally simple — one global window, no
 * per-user tiers — we're not building a distributed rate-limiting platform.
 */
export const RateLimit = (limit: number) => SetMetadata(RATE_LIMIT_KEY, limit);
