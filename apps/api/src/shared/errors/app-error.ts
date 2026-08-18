import { HttpException, HttpStatus } from '@nestjs/common';

// Base for expected, domain-level errors. The global filter treats these
// differently from unexpected exceptions — specific message here, generic
// 500 for everything else — so we don't leak internals to callers.
export class AppError extends HttpException {
  /**
   * `details` merges extra, developer-facing fields into the response
   * body alongside message/code — e.g. a rate limiter's
   * `retryAfterSeconds`. Only put things here that are safe to hand a
   * client; the global filter forwards this verbatim.
   */
  constructor(message: string, status: HttpStatus, code: string, details?: Record<string, unknown>) {
    super({ message, code, ...details }, status);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`, HttpStatus.NOT_FOUND, 'NOT_FOUND');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have access to this resource') {
    super(message, HttpStatus.FORBIDDEN, 'FORBIDDEN');
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, HttpStatus.CONFLICT, 'CONFLICT');
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Invalid or missing credentials') {
    super(message, HttpStatus.UNAUTHORIZED, 'UNAUTHORIZED');
  }
}

export class ValidationFailedError extends AppError {
  constructor(message: string) {
    super(message, HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED');
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests — please try again later') {
    super(message, HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED');
  }
}
