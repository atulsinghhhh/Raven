import { HttpStatus } from '@nestjs/common';
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  TooManyRequestsError,
  UnauthorizedError,
  ValidationFailedError,
} from './app-error';
import { LEGACY_ERROR_CODE, RavenErrorCode } from './error-codes';

function bodyOf(error: AppError): Record<string, unknown> {
  return error.getResponse() as Record<string, unknown>;
}

describe('AppError', () => {
  it('puts the canonical code on the response body', () => {
    const error = new AppError('nope', HttpStatus.BAD_REQUEST, RavenErrorCode.VALIDATION_FAILED);

    expect(bodyOf(error).code).toBe('RAVEN_VALIDATION_FAILED');
  });

  it('ships the pre-prefix code alongside it for one deprecation window', () => {
    // Callers switching on the old value keep working while they migrate.
    const error = new AppError('nope', HttpStatus.NOT_FOUND, RavenErrorCode.ROOM_NOT_FOUND);

    expect(bodyOf(error).legacyCode).toBe('NOT_FOUND');
  });

  it('merges details into the body without letting them overwrite the code', () => {
    const error = new AppError('slow down', HttpStatus.TOO_MANY_REQUESTS, RavenErrorCode.RATE_LIMITED, {
      retryAfterSeconds: 30,
    });

    expect(bodyOf(error)).toMatchObject({
      code: 'RAVEN_RATE_LIMITED',
      retryAfterSeconds: 30,
    });
  });

  it('exposes the code as a property, not only inside the serialised body', () => {
    // Services and interceptors branch on this without re-parsing the body.
    expect(new ForbiddenError().code).toBe(RavenErrorCode.PERMISSION_DENIED);
  });
});

describe('error subclasses', () => {
  it.each([
    [new NotFoundError('Project'), HttpStatus.NOT_FOUND, RavenErrorCode.NOT_FOUND],
    [new ForbiddenError(), HttpStatus.FORBIDDEN, RavenErrorCode.PERMISSION_DENIED],
    [new ConflictError('taken'), HttpStatus.CONFLICT, RavenErrorCode.CONFLICT],
    [new UnauthorizedError(), HttpStatus.UNAUTHORIZED, RavenErrorCode.AUTH_ERROR],
    [new ValidationFailedError('bad'), HttpStatus.BAD_REQUEST, RavenErrorCode.VALIDATION_FAILED],
    [new TooManyRequestsError(), HttpStatus.TOO_MANY_REQUESTS, RavenErrorCode.RATE_LIMITED],
  ])('maps status and code together', (error, status, code) => {
    expect(error.getStatus()).toBe(status);
    expect(bodyOf(error).code).toBe(code);
  });

  it('lets a caller be specific about which resource was missing', () => {
    // A 404 that says only "not found" forces the developer to guess which
    // of the three ids in their request was the bad one.
    const error = new NotFoundError('Room', RavenErrorCode.ROOM_NOT_FOUND);

    expect(bodyOf(error).code).toBe('RAVEN_ROOM_NOT_FOUND');
    expect(error.message).toBe('Room not found');
  });

  it('still defaults to the generic code when no specific one fits', () => {
    expect(bodyOf(new NotFoundError('Webhook endpoint')).code).toBe('RAVEN_NOT_FOUND');
  });
});

describe('the code registry', () => {
  it('gives every canonical code a legacy mapping', () => {
    // A missing entry would serialise `legacyCode: undefined` and quietly
    // break exactly the callers the field exists to protect.
    for (const code of Object.values(RavenErrorCode)) {
      expect(typeof LEGACY_ERROR_CODE[code]).toBe('string');
    }
  });

  it('prefixes every canonical code', () => {
    // The prefix is what stops these colliding with an application's own
    // error codes once they have been through an SDK.
    for (const code of Object.values(RavenErrorCode)) {
      expect(code.startsWith('RAVEN_')).toBe(true);
    }
  });

  it('never prefixes a legacy code', () => {
    for (const legacy of Object.values(LEGACY_ERROR_CODE)) {
      expect(legacy.startsWith('RAVEN_')).toBe(false);
    }
  });
});
