import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'rateLimit';

/**
 * Caps a route to `limit` requests per rate-limit window (see
 * RATE_LIMIT_WINDOW_SECONDS) per client IP. Deliberately simple — a
 * single global window, IP-keyed — per the instruction not to build a
 * distributed rate-limiting platform for Phase 2. See
 * docs/control-plane.md#rate-limiting.
 */
export const RateLimit = (limit: number) => SetMetadata(RATE_LIMIT_KEY, limit);
