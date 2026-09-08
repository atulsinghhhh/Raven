import { ConfigService } from '@nestjs/config';
import { ExecutionContext } from '@nestjs/common';
import { UnauthorizedError } from '../../../shared/errors/app-error';
import { SfuRegistrationGuard } from './sfu-registration.guard';

const SECRET = 'sfu-registration-secret-value';

function guardWith(secret?: string): SfuRegistrationGuard {
  return new SfuRegistrationGuard({
    get: (key: string) => (key === 'sfu.registrationSecret' ? secret : undefined),
  } as unknown as ConfigService);
}

function contextWith(authorization?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: authorization ? { authorization } : {}, ip: '10.0.0.5' }),
    }),
  } as unknown as ExecutionContext;
}

describe('SfuRegistrationGuard', () => {
  it('admits a node presenting the fleet secret', () => {
    expect(guardWith(SECRET).canActivate(contextWith(`Bearer ${SECRET}`))).toBe(true);
  });

  it('rejects a missing Authorization header', () => {
    expect(() => guardWith(SECRET).canActivate(contextWith())).toThrow(UnauthorizedError);
  });

  it('rejects a wrong secret', () => {
    expect(() => guardWith(SECRET).canActivate(contextWith('Bearer nope'))).toThrow(
      UnauthorizedError,
    );
  });

  it('rejects a secret of a different length without throwing on the compare', () => {
    // timingSafeEqual throws on length mismatch, which would itself be a
    // length oracle: the guard hashes first so both inputs are 32 bytes.
    expect(() => guardWith(SECRET).canActivate(contextWith('Bearer a'))).toThrow(UnauthorizedError);
  });

  it('rejects a non-Bearer scheme', () => {
    expect(() => guardWith(SECRET).canActivate(contextWith(`Basic ${SECRET}`))).toThrow(
      UnauthorizedError,
    );
  });

  it('fails closed when no secret is configured', () => {
    // An unconfigured deployment must not have an open registration
    // endpoint: the node gets a clear error instead.
    expect(() => guardWith(undefined).canActivate(contextWith('Bearer anything'))).toThrow(
      UnauthorizedError,
    );
  });

  it('fails closed even when the caller presents an empty bearer token', () => {
    expect(() => guardWith('').canActivate(contextWith('Bearer '))).toThrow(UnauthorizedError);
  });
});
