import { ConfigService } from '@nestjs/config';
import { ExecutionContext } from '@nestjs/common';
import { UnauthorizedError } from '../../shared/errors/app-error';
import { MetricsAuthGuard } from './metrics-auth.guard';

const SECRET = 'metrics-scrape-secret-value';

function guardWith(secret?: string): MetricsAuthGuard {
  return new MetricsAuthGuard({
    get: (key: string) => (key === 'metrics.scrapeSecret' ? secret : undefined),
  } as unknown as ConfigService);
}

function contextWith(authorization?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: authorization ? { authorization } : {} }),
    }),
  } as unknown as ExecutionContext;
}

describe('MetricsAuthGuard', () => {
  it('admits a scraper presenting the shared secret', () => {
    expect(guardWith(SECRET).canActivate(contextWith(`Bearer ${SECRET}`))).toBe(true);
  });

  it('rejects a missing Authorization header', () => {
    expect(() => guardWith(SECRET).canActivate(contextWith())).toThrow(UnauthorizedError);
  });

  it('rejects a wrong secret', () => {
    expect(() => guardWith(SECRET).canActivate(contextWith('Bearer nope'))).toThrow(UnauthorizedError);
  });

  it('rejects a non-Bearer scheme', () => {
    expect(() => guardWith(SECRET).canActivate(contextWith(`Basic ${SECRET}`))).toThrow(UnauthorizedError);
  });

  it('fails closed when no secret is configured', () => {
    // An unconfigured deployment must not leave /metrics open: the
    // operator's Prometheus gets a clear error instead of silent success.
    expect(() => guardWith(undefined).canActivate(contextWith('Bearer anything'))).toThrow(UnauthorizedError);
  });
});
