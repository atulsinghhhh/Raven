import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../../shared/redis/redis.service';
import { DashboardWsTokenService } from './dashboard-ws-token.service';

const CONFIG: Record<string, unknown> = {
  'dashboardWs.tokenSecret': 'test-dashboard-ws-secret-that-is-long-enough',
  'dashboardWs.tokenTtlSeconds': 300,
  publicUrl: 'https://api.example.com',
};

function makeService(redisOverrides: Partial<{ exists: jest.Mock; set: jest.Mock }> = {}) {
  const config = { get: (key: string) => CONFIG[key] } as unknown as ConfigService;
  const client = {
    exists: redisOverrides.exists ?? jest.fn().mockResolvedValue(0),
    set: redisOverrides.set ?? jest.fn().mockResolvedValue('OK'),
  };
  const redis = { client } as unknown as RedisService;
  return { service: new DashboardWsTokenService(config, redis), client };
}

describe('issue', () => {
  it('signs the project id and user id as claims', () => {
    const { service } = makeService();
    const issued = service.issue({ projectId: 'p1', userId: 'alice' });
    expect(issued.projectId).toBe('p1');
    expect(issued.userId).toBe('alice');
  });

  it('uses the configured TTL', () => {
    const { service } = makeService();
    const issued = service.issue({ projectId: 'p1', userId: 'alice' });
    const lifetimeSeconds = (issued.expiresAt.getTime() - Date.now()) / 1000;
    expect(lifetimeSeconds).toBeGreaterThan(295);
    expect(lifetimeSeconds).toBeLessThanOrEqual(300);
  });

  it('derives a wss:// dashboard URL from the API URL, so only one address is configured', () => {
    const { service } = makeService();
    const issued = service.issue({ projectId: 'p1', userId: 'alice' });
    expect(issued.wsUrl).toBe('wss://api.example.com/v1/dashboard/ws');
  });

  it('gives every token a distinct id, so one can be revoked without touching the rest', () => {
    const { service } = makeService();
    const a = service.issue({ projectId: 'p1', userId: 'alice' });
    const b = service.issue({ projectId: 'p1', userId: 'alice' });
    expect(a.tokenId).not.toBe(b.tokenId);
    expect(a.tokenId).toMatch(/^dwt_/);
  });
});

describe('verify', () => {
  it('accepts a token it issued and returns its claims', async () => {
    const { service } = makeService();
    const issued = service.issue({ projectId: 'p1', userId: 'alice' });

    const claims = await service.verify(issued.token);
    expect(claims.sub).toBe('alice');
    expect(claims.pid).toBe('p1');
  });

  it('rejects a token signed with a different key', async () => {
    const { service } = makeService();
    const issued = service.issue({ projectId: 'p1', userId: 'alice' });

    const other = new DashboardWsTokenService(
      {
        get: (key: string) => (key === 'dashboardWs.tokenSecret' ? 'a-completely-different-secret' : CONFIG[key]),
      } as unknown as ConfigService,
      { client: { exists: jest.fn().mockResolvedValue(0) } } as unknown as RedisService,
    );

    await expect(other.verify(issued.token)).rejects.toMatchObject({ wsCode: 'INVALID_TOKEN' });
  });

  it('rejects a token whose payload was tampered with (project swapped)', async () => {
    const { service } = makeService();
    const issued = service.issue({ projectId: 'p1', userId: 'alice' });

    const [header, , signature] = issued.token.split('.');
    const forged = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(issued.token.split('.')[1], 'base64url').toString()),
        pid: 'someone-elses-project',
      }),
    ).toString('base64url');

    await expect(service.verify(`${header}.${forged}.${signature}`)).rejects.toMatchObject({
      wsCode: 'INVALID_TOKEN',
    });
  });

  it('rejects an expired token with a specific code, so the client knows to refresh', async () => {
    const { service } = makeService();
    const signed = (service as unknown as { sign: (claims: unknown) => string }).sign.call(service, {
      jti: 'dwt_old',
      sub: 'alice',
      pid: 'p1',
      iat: Math.floor(Date.now() / 1000) - 7200,
      exp: Math.floor(Date.now() / 1000) - 3600,
      aud: 'raven-dashboard',
      iss: 'raven',
    });

    await expect(service.verify(signed)).rejects.toMatchObject({ wsCode: 'TOKEN_EXPIRED' });
  });

  it('rejects a correctly-signed token minted for a different audience', async () => {
    const { service } = makeService();
    const signed = (service as unknown as { sign: (claims: unknown) => string }).sign.call(service, {
      jti: 'dwt_x',
      sub: 'alice',
      pid: 'p1',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,
      aud: 'raven-chat',
      iss: 'raven',
    });

    await expect(service.verify(signed)).rejects.toMatchObject({ wsCode: 'INVALID_TOKEN' });
  });

  it.each([
    ['', 'empty'],
    ['not-a-token', 'not a JWT'],
    ['a.b', 'too few parts'],
    ['a.b.c.d', 'too many parts'],
  ])('rejects a malformed token (%s)', async (raw) => {
    const { service } = makeService();
    await expect(service.verify(raw)).rejects.toMatchObject({ wsCode: 'INVALID_TOKEN' });
  });

  it('rejects a revoked token', async () => {
    const { service } = makeService({ exists: jest.fn().mockResolvedValue(1) });
    const issued = service.issue({ projectId: 'p1', userId: 'alice' });
    await expect(service.verify(issued.token)).rejects.toMatchObject({ wsCode: 'TOKEN_REVOKED' });
  });

  it('still accepts a valid token when Redis is unreachable', async () => {
    // Revocation is delayed instead of the dashboard being unusable: a
    // Redis outage must not lock every user out.
    const { service } = makeService({ exists: jest.fn().mockRejectedValue(new Error('redis down')) });
    const issued = service.issue({ projectId: 'p1', userId: 'alice' });
    await expect(service.verify(issued.token)).resolves.toMatchObject({ sub: 'alice' });
  });
});

describe('revoke', () => {
  it('sets a tombstone that only outlives the token itself', async () => {
    const { service, client } = makeService();
    const expiresAt = new Date(Date.now() + 300_000);

    await service.revoke('dwt_abc', expiresAt);

    expect(client.set).toHaveBeenCalledWith(expect.stringContaining('dwt_abc'), '1', 'EX', expect.any(Number));
    const ttl = client.set.mock.calls[0][3] as number;
    expect(ttl).toBeGreaterThan(290);
    expect(ttl).toBeLessThanOrEqual(301);
  });

  it('uses a minimum TTL for an already-expired token rather than a negative one', async () => {
    const { service, client } = makeService();
    await service.revoke('dwt_old', new Date(Date.now() - 10_000));
    expect(client.set.mock.calls[0][3]).toBeGreaterThanOrEqual(1);
  });
});
