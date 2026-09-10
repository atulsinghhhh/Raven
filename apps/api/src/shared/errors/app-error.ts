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

/**
 * The caller's developer account has spent its included Livqeno minutes.
 *
 * 403, not 402: `402 Payment Required` tells a client there is something to
 * pay, and there isn't — Livqeno has no billing. It is also not 429; a rate
 * limit clears by waiting, and this does not clear at all.
 *
 * `details` carries the allowance figures so an SDK can render "0 of 20,000
 * minutes remaining" straight off the error, without a second request.
 */
export class UsageLimitExceededError extends AppError {
  constructor(details: { includedMinutes: number; usedMinutes: number; remainingMinutes: number }) {
    super(
      `This account has used all ${details.includedMinutes} of its included Livqeno minutes. ` +
        'New RTC sessions are refused until more minutes are allocated.',
      HttpStatus.FORBIDDEN,
      RavenErrorCode.USAGE_LIMIT_EXCEEDED,
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
