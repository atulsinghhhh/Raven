import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Base class for expected, domain-level errors. Distinguishing these from
 * unexpected exceptions lets the global filter return safe, specific
 * messages for the former and a generic message for the latter, so we
 * never leak internals (stack traces, DB errors) to API consumers.
 */
export class AppError extends HttpException {
  constructor(message: string, status: HttpStatus, code: string) {
    super({ message, code }, status);
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
