import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { TooManyRequestsError } from '../errors/app-error';
import { RedisService } from '../redis/redis.service';
import { RateLimitGuard } from './rate-limit.guard';

describe('RateLimitGuard', () => {
  let guard: RateLimitGuard;
  let redis: { incr: jest.Mock; expire: jest.Mock; ttl: jest.Mock };
  let reflector: { get: jest.Mock };

  function contextWith(request: Record<string, unknown>): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getClass: () => ({ name: 'TestController' }),
      getHandler: () => ({ name: 'testRoute' }),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    redis = {
      incr: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      ttl: jest.fn().mockResolvedValue(60),
    };
    reflector = { get: jest.fn().mockReturnValue(5) };
    const configService = { get: jest.fn().mockReturnValue(60) };

    guard = new RateLimitGuard(
      reflector as unknown as Reflector,
      { client: redis } as unknown as RedisService,
      configService as unknown as ConfigService,
    );
  });

  it('passes through untouched when the route carries no @RateLimit', async () => {
    reflector.get.mockReturnValue(undefined);

    await expect(guard.canActivate(contextWith({}))).resolves.toBe(true);
    expect(redis.incr).not.toHaveBeenCalled();
  });

  it('allows the request while under the limit', async () => {
    redis.incr.mockResolvedValue(3);

    await expect(guard.canActivate(contextWith({ ip: '203.0.113.7' }))).resolves.toBe(true);
  });

  it('refuses once the count exceeds the limit', async () => {
    redis.incr.mockResolvedValue(6);

    await expect(guard.canActivate(contextWith({ ip: '203.0.113.7' }))).rejects.toBeInstanceOf(
      TooManyRequestsError,
    );
  });

  it('reports retryAfterSeconds from the key’s actual TTL', async () => {
    redis.incr.mockResolvedValue(6);
    redis.ttl.mockResolvedValue(42);

    const error = await guard.canActivate(contextWith({ ip: '203.0.113.7' })).catch((e) => e);

    expect(error).toBeInstanceOf(TooManyRequestsError);
    expect(error.getResponse()).toMatchObject({ retryAfterSeconds: 42 });
  });

  it('falls back to the window length when TTL is unavailable', async () => {
    // A key that raced past its own EXPIRE (or a Redis blip) should not
    // crash the refusal: the window length is the best remaining guess.
    redis.incr.mockResolvedValue(6);
    redis.ttl.mockResolvedValue(-1);

    const error = await guard.canActivate(contextWith({ ip: '203.0.113.7' })).catch((e) => e);

    expect(error).toBeInstanceOf(TooManyRequestsError);
    expect(error.getResponse()).toMatchObject({ retryAfterSeconds: 60 });
  });

  describe('identity keying', () => {
    it('keys on the API key’s own public id when one authenticated the request', async () => {
      await guard.canActivate(
        contextWith({ apiKeyPublicId: 'rvk_prod_abc', apiProjectId: 'p1', ip: '203.0.113.7' }),
      );

      expect(redis.incr).toHaveBeenCalledWith(expect.stringContaining('apikey:rvk_prod_abc'));
    });

    it('never falls back to project id or IP once a key is present', async () => {
      // Two keys on the same project must not share a budget: a noisy or
      // compromised key should not spend the project's other keys'
      // headroom, and each key is revocable independently for exactly
      // this kind of isolation.
      await guard.canActivate(
        contextWith({ apiKeyPublicId: 'rvk_prod_abc', apiProjectId: 'p1', ip: '203.0.113.7' }),
      );

      const key = redis.incr.mock.calls[0][0] as string;
      expect(key).not.toContain('p1');
      expect(key).not.toContain('203.0.113.7');
    });

    it('keys two different API keys on the same project separately', async () => {
      await guard.canActivate(contextWith({ apiKeyPublicId: 'rvk_prod_aaa', apiProjectId: 'p1' }));
      await guard.canActivate(contextWith({ apiKeyPublicId: 'rvk_prod_bbb', apiProjectId: 'p1' }));

      const [firstKey] = redis.incr.mock.calls[0];
      const [secondKey] = redis.incr.mock.calls[1];
      expect(firstKey).not.toBe(secondKey);
    });

    it('keys on the JWT user id when there is no API key', async () => {
      await guard.canActivate(contextWith({ user: { id: 'user-1' }, ip: '203.0.113.7' }));

      expect(redis.incr).toHaveBeenCalledWith(expect.stringContaining('user:user-1'));
    });

    it('never falls back to IP once a user is present', async () => {
      // The failure this avoids: every legitimate user behind one
      // corporate NAT sharing a single IP-keyed bucket.
      await guard.canActivate(contextWith({ user: { id: 'user-1' }, ip: '203.0.113.7' }));

      const key = redis.incr.mock.calls[0][0] as string;
      expect(key).not.toContain('203.0.113.7');
    });

    it('gives two users behind the same IP independent budgets', async () => {
      await guard.canActivate(contextWith({ user: { id: 'user-1' }, ip: '203.0.113.7' }));
      await guard.canActivate(contextWith({ user: { id: 'user-2' }, ip: '203.0.113.7' }));

      const [firstKey] = redis.incr.mock.calls[0];
      const [secondKey] = redis.incr.mock.calls[1];
      expect(firstKey).not.toBe(secondKey);
    });

    it('falls back to IP only when no identity exists at all', async () => {
      // The one case this guard cannot avoid: login and register happen
      // before any identity exists, so IP is the only signal available.
      await guard.canActivate(contextWith({ ip: '203.0.113.7' }));

      expect(redis.incr).toHaveBeenCalledWith(expect.stringContaining('ip:203.0.113.7'));
    });

    it('still limits an unidentifiable request rather than skipping it', async () => {
      await guard.canActivate(contextWith({}));

      expect(redis.incr).toHaveBeenCalledWith(expect.stringContaining('ip:unknown'));
    });

    it('prefers the API key over a user id if a request somehow carried both', async () => {
      await guard.canActivate(
        contextWith({ apiKeyPublicId: 'rvk_prod_abc', user: { id: 'user-1' } }),
      );

      expect(redis.incr).toHaveBeenCalledWith(expect.stringContaining('apikey:rvk_prod_abc'));
      expect(redis.incr).not.toHaveBeenCalledWith(expect.stringContaining('user:user-1'));
    });
  });

  describe('window bookkeeping', () => {
    it('sets an expiry only on the first hit in a window', async () => {
      redis.incr.mockResolvedValue(1);

      await guard.canActivate(contextWith({ ip: '203.0.113.7' }));

      expect(redis.expire).toHaveBeenCalledWith(expect.any(String), 60);
    });

    it('does not re-arm the expiry on subsequent hits', async () => {
      redis.incr.mockResolvedValue(2);

      await guard.canActivate(contextWith({ ip: '203.0.113.7' }));

      expect(redis.expire).not.toHaveBeenCalled();
    });

    it('scopes the key to the route, so one limit cannot bleed into another', async () => {
      await guard.canActivate(contextWith({ ip: '203.0.113.7' }));

      expect(redis.incr).toHaveBeenCalledWith(
        expect.stringContaining('TestController.testRoute'),
      );
    });
  });
});
