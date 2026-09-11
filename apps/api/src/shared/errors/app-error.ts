import { HttpException, HttpStatus } from '@nestjs/common';
import { LEGACY_ERROR_CODE, RavenErrorCode } from './error-codes';

// Base for expected, domain-level errors. The global filter treats these
// differently from unexpected exceptions: specific message here, generic
// 500 for everything else, so we don't leak internals to callers.
export class AppError extends HttpException {
  readonly code: RavenErrorCode;

  /**
   * `details` merges extra, developer-facing fields into the response
   * body alongside message/code: e.g. a rate limiter's
   * `retryAfterSeconds`. Only put things here that are safe to hand a
   * client; the global filter forwards this verbatim.
   */
  constructor(message: string, status: HttpStatus, code: RavenErrorCode, details?: Record<string, unknown>) {
    // `legacyCode` is what this error was called before the RAVEN_ prefix
    // existed. It ships for one deprecation window so callers switching on
    // the old value keep working; docs/error-codes.md tracks its removal.
    super({ message, code, legacyCode: LEGACY_ERROR_CODE[code], ...details }, status);
    this.code = code;
  }
}

export class NotFoundError extends AppError {
  /**
   * `code` lets a caller be specific: a missing room reports
   * RAVEN_ROOM_NOT_FOUND instead of the generic code: without every
   * resource needing its own subclass.
   */
  constructor(resource: string, code: RavenErrorCode = RavenErrorCode.NOT_FOUND) {
    super(`${resource} not found`, HttpStatus.NOT_FOUND, code);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have access to this resource') {
    super(message, HttpStatus.FORBIDDEN, RavenErrorCode.PERMISSION_DENIED);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code: RavenErrorCode = RavenErrorCode.CONFLICT) {
    super(message, HttpStatus.CONFLICT, code);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Invalid or missing credentials', code: RavenErrorCode = RavenErrorCode.AUTH_ERROR) {
    super(message, HttpStatus.UNAUTHORIZED, code);
  }
}

export class ValidationFailedError extends AppError {
  constructor(message: string) {
    super(message, HttpStatus.BAD_REQUEST, RavenErrorCode.VALIDATION_FAILED);
  }
}

/** Which free-tier pool a `UsageLimitExceededError` refers to. */
export type UsageLimitProduct = 'RTC' | 'CHAT' | 'LIVE_STREAMING';

const USAGE_LIMIT_UNIT: Record<UsageLimitProduct, string> = {
  RTC: 'participant minutes',
  CHAT: 'messages',
  LIVE_STREAMING: 'host hours',
};

export interface UsageLimitExceededDetails {
  product: UsageLimitProduct;
  unit: 'participant_minutes' | 'messages' | 'host_hours';
  included: number;
  used: number;
  remaining: number;
  /**
   * RTC only. Kept alongside the generic fields above for backward
   * compatibility with SDK/dashboard code that parses these exact keys —
   * they predate `product`/`unit`/`included`/`used`/`remaining`, which
   * cover RTC, CHAT and LIVE_STREAMING uniformly.
   */
  includedMinutes?: number;
  usedMinutes?: number;
  remainingMinutes?: number;
}

/**
 * The caller's developer account has spent one of its independent free-tier
 * pools (RTC minutes, Chat messages, or Live Streaming host-hours — see
 * `UsageProduct`). Each pool is exhausted independently: using up Chat's
 * messages never blocks RTC, and vice versa.
 *
 * 403, not 402: `402 Payment Required` tells a client there is something to
 * pay, and there isn't — Livqeno has no billing. It is also not 429; a rate
 * limit clears by waiting, and this does not clear at all.
 *
 * `details` carries the allowance figures so an SDK can render "0 of 20,000
 * minutes remaining" straight off the error, without a second request.
 */
export class UsageLimitExceededError extends AppError {
  constructor(details: UsageLimitExceededDetails) {
    super(
      `This account has used all ${details.included} of its included Livqeno ${USAGE_LIMIT_UNIT[details.product]}. ` +
        'New usage is refused until more is allocated.',
      HttpStatus.FORBIDDEN,
      RavenErrorCode.USAGE_LIMIT_EXCEEDED,
      details as unknown as Record<string, unknown>,
    );
  }
}

/**
 * Free-tier Live Streaming already has a stream LIVE for this account —
 * across all of its projects and environments, the same account-wide scope
 * `UsageAllowance` already uses.
 *
 * Deliberately not `UsageLimitExceededError`: a concurrency cap is "you can
 * have another, just not running at the same time as this one," not "you're
 * out and need more allocated" — conflating the two would make a caller
 * unable to tell "wait for the other stream to end" apart from "nothing
 * left to give."
 */
export class LiveStreamConcurrencyLimitExceededError extends AppError {
  constructor(details: { maxConcurrentStreams: number }) {
    super(
      `This account already has ${details.maxConcurrentStreams} live stream(s) running — the free tier allows ` +
        'only one at a time, across every project and environment. End it before starting another.',
      HttpStatus.FORBIDDEN,
      RavenErrorCode.STREAM_CONCURRENCY_LIMIT_EXCEEDED,
      details,
    );
  }
}

/** Free-tier Live Streaming's viewer cap for one stream is reached. */
export class LiveStreamViewerLimitExceededError extends AppError {
  constructor(details: { maxViewers: number }) {
    super(
      `This stream already has ${details.maxViewers} viewers — the free tier's per-stream limit.`,
      HttpStatus.FORBIDDEN,
      RavenErrorCode.STREAM_VIEWER_LIMIT_EXCEEDED,
      details,
    );
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests — please try again later', details?: Record<string, unknown>) {
    super(message, HttpStatus.TOO_MANY_REQUESTS, RavenErrorCode.RATE_LIMITED, details);
  }
}

/**
 * The deployment is at its configured concurrency ceiling for this
 * operation.
 *
 * ## Why this exists at all
 *
 * Before it did, a burst of roughly a hundred simultaneous credential
 * mints exhausted the `pg` pool: every connection was busy, the surplus
 * queued inside the pool, and after
 * `DATABASE_POOL_CONNECTION_TIMEOUT_MS` the acquisition gave up. Prisma
 * surfaced that as an error nothing recognised, so it left the API as
 * `500 RAVEN_INTERNAL_ERROR` — a response that tells a developer their
 * integration is broken when in fact the service was simply full, and one
 * that no sane client retries. Worse, the whole process stayed wedged
 * afterwards, because the backlog outlived the requests that created it.
 *
 * So overload gets a name. 503 rather than 429 because the limit is ours
 * rather than the caller's, and `retryAfterSeconds` because unlike a rate
 * limit this genuinely does clear in about as long as one request takes.
 *
 * See docs/production/capacity.md for the configured limits and the
 * measured numbers behind them.
 */
export class CapacityExceededError extends AppError {
  constructor(operation: string, details?: { retryAfterSeconds?: number; limit?: number }) {
    super(
      `${operation} is at capacity right now — retry shortly. ` +
        'This is a server-side concurrency limit, not a per-key rate limit.',
      HttpStatus.SERVICE_UNAVAILABLE,
      RavenErrorCode.CAPACITY_EXCEEDED,
      details,
    );
  }
}
