import { ConfigService } from '@nestjs/config';
import { ChatMemberRole } from '../../../generated/prisma/client';
import { RedisService } from '../../../shared/redis/redis.service';
import { ChatTokenService } from './chat-token.service';

const CONFIG: Record<string, unknown> = {
  'chat.tokenSecret': 'test-chat-secret-that-is-long-enough',
  'chat.tokenDefaultTtlSeconds': 3600,
  'chat.tokenMaxTtlSeconds': 21600,
  publicUrl: 'https://api.example.com',
};

function makeService(redisOverrides: Partial<{ exists: jest.Mock; set: jest.Mock }> = {}) {
  const config = { get: (key: string) => CONFIG[key] } as unknown as ConfigService;
  const client = {
    exists: redisOverrides.exists ?? jest.fn().mockResolvedValue(0),
    set: redisOverrides.set ?? jest.fn().mockResolvedValue('OK'),
  };
  const redis = { client } as unknown as RedisService;
  return { service: new ChatTokenService(config, redis), client };
}

describe('issue', () => {
  it('derives scopes from the member role', () => {
    const { service } = makeService();
    expect(service.issue({ projectId: 'p1', userId: 'alice', conversations: [], role: ChatMemberRole.MEMBER }).scopes).toEqual([
      'chat:read',
      'chat:send',
    ]);
    expect(service.issue({ projectId: 'p1', userId: 'alice', conversations: [], role: ChatMemberRole.ADMIN }).scopes).toEqual([
      'chat:read',
      'chat:send',
      'chat:moderate',
      'chat:manage',
    ]);
  });

  it('lets requested scopes narrow but never widen', () => {
    const { service } = makeService();

    const narrowed = service.issue({
      projectId: 'p1',
      userId: 'alice',
      conversations: [],
      role: ChatMemberRole.MEMBER,
      requestedScopes: ['chat:read'],
    });
    expect(narrowed.scopes).toEqual(['chat:read']);

    // A MEMBER asking for moderate rights does not get them — this is the
    // check that makes it safe to pass a caller's scope list straight
    // through without re-validating it.
    const escalated = service.issue({
      projectId: 'p1',
      userId: 'alice',
      conversations: [],
      role: ChatMemberRole.MEMBER,
      requestedScopes: ['chat:moderate', 'chat:manage'],
    });
    expect(escalated.scopes).toEqual([]);
  });

  it('ignores scope strings that are not real scopes', () => {
    const { service } = makeService();
    const issued = service.issue({
      projectId: 'p1',
      userId: 'alice',
      conversations: [],
      role: ChatMemberRole.ADMIN,
      requestedScopes: ['chat:read', 'chat:everything', 'admin'],
    });
    expect(issued.scopes).toEqual(['chat:read']);
  });

  it('caps the TTL at the configured maximum — there is no long-lived chat token', () => {
    const { service } = makeService();
    const issued = service.issue({
      projectId: 'p1',
      userId: 'alice',
      conversations: [],
      role: ChatMemberRole.MEMBER,
      ttlSeconds: 999_999,
    });
    const lifetimeSeconds = (issued.expiresAt.getTime() - Date.now()) / 1000;
    expect(lifetimeSeconds).toBeLessThanOrEqual(21_600 + 1);
  });

  it('derives a wss:// chat URL from the API URL, so only one address is configured', () => {
    const { service } = makeService();
    const issued = service.issue({ projectId: 'p1', userId: 'alice', conversations: [], role: ChatMemberRole.MEMBER });
    expect(issued.chatUrl).toBe('wss://api.example.com/v1/chat/ws');
  });

  it('gives every token a distinct id, so one can be revoked without touching the rest', () => {
    const { service } = makeService();
    const a = service.issue({ projectId: 'p1', userId: 'alice', conversations: [], role: ChatMemberRole.MEMBER });
    const b = service.issue({ projectId: 'p1', userId: 'alice', conversations: [], role: ChatMemberRole.MEMBER });
    expect(a.tokenId).not.toBe(b.tokenId);
    expect(a.tokenId).toMatch(/^ctk_/);
  });
});

describe('verify', () => {
  it('accepts a token it issued and returns its claims', async () => {
    const { service } = makeService();
    const issued = service.issue({
      projectId: 'p1',
      userId: 'alice',
      conversations: ['conv_1'],
      role: ChatMemberRole.MODERATOR,
    });

    const claims = await service.verify(issued.token);
    expect(claims.sub).toBe('alice');
    expect(claims.pid).toBe('p1');
    expect(claims.cvs).toEqual(['conv_1']);
    expect(claims.scopes).toContain('chat:moderate');
  });

  it('rejects a token signed with a different key', async () => {
    const { service } = makeService();
    const issued = service.issue({ projectId: 'p1', userId: 'alice', conversations: [], role: ChatMemberRole.MEMBER });

    const other = new ChatTokenService(
      { get: (key: string) => (key === 'chat.tokenSecret' ? 'a-completely-different-secret' : CONFIG[key]) } as unknown as ConfigService,
      { client: { exists: jest.fn().mockResolvedValue(0) } } as unknown as RedisService,
    );

    await expect(other.verify(issued.token)).rejects.toMatchObject({ chatCode: 'INVALID_TOKEN' });
  });

  it('rejects a token whose payload was tampered with', async () => {
    const { service } = makeService();
    const issued = service.issue({ projectId: 'p1', userId: 'alice', conversations: [], role: ChatMemberRole.MEMBER });

    // Swap the subject for someone else's and keep the original signature.
    const [header, , signature] = issued.token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(issued.token.split('.')[1], 'base64url').toString()), sub: 'mallory' }),
    ).toString('base64url');

    await expect(service.verify(`${header}.${forged}.${signature}`)).rejects.toMatchObject({
      chatCode: 'INVALID_TOKEN',
    });
  });

  it('rejects an expired token with a specific code, so the client knows to refresh', async () => {
    const { service } = makeService();
    // Sign a token that is already past its expiry.
    const signed = (service as unknown as { sign: (claims: unknown) => string }).sign.call(service, {
      jti: 'ctk_old',
      sub: 'alice',
      pid: 'p1',
      cvs: [],
      scopes: ['chat:read'],
      iat: Math.floor(Date.now() / 1000) - 7200,
      exp: Math.floor(Date.now() / 1000) - 3600,
      aud: 'raven-chat',
      iss: 'raven',
    });

    await expect(service.verify(signed)).rejects.toMatchObject({ chatCode: 'TOKEN_EXPIRED' });
  });

  it('rejects a correctly-signed token minted for a different audience', async () => {
    const { service } = makeService();
    const signed = (service as unknown as { sign: (claims: unknown) => string }).sign.call(service, {
      jti: 'ctk_x',
      sub: 'alice',
      pid: 'p1',
      cvs: [],
      scopes: [],
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 600,
      aud: 'some-other-service',
      iss: 'raven',
    });

    await expect(service.verify(signed)).rejects.toMatchObject({ chatCode: 'INVALID_TOKEN' });
  });

  it.each([['', 'empty'], ['not-a-token', 'not a JWT'], ['a.b', 'too few parts'], ['a.b.c.d', 'too many parts']])(
    'rejects a malformed token (%s)',
    async (raw) => {
      const { service } = makeService();
      await expect(service.verify(raw)).rejects.toMatchObject({ chatCode: 'INVALID_TOKEN' });
    },
  );

  it('rejects a revoked token', async () => {
    const { service } = makeService({ exists: jest.fn().mockResolvedValue(1) });
    const issued = service.issue({ projectId: 'p1', userId: 'alice', conversations: [], role: ChatMemberRole.MEMBER });
    await expect(service.verify(issued.token)).rejects.toMatchObject({ chatCode: 'TOKEN_REVOKED' });
  });

  it('still accepts a valid token when Redis is unreachable', async () => {
    // Revocation is delayed rather than chat being unusable — a Redis
    // outage must not lock every user out (spec §52).
    const { service } = makeService({ exists: jest.fn().mockRejectedValue(new Error('redis down')) });
    const issued = service.issue({ projectId: 'p1', userId: 'alice', conversations: [], role: ChatMemberRole.MEMBER });
    await expect(service.verify(issued.token)).resolves.toMatchObject({ sub: 'alice' });
  });
});

describe('revoke', () => {
  it('sets a tombstone that only outlives the token itself', async () => {
    const { service, client } = makeService();
    const expiresAt = new Date(Date.now() + 300_000);

    await service.revoke('ctk_abc', expiresAt);

    expect(client.set).toHaveBeenCalledWith(
      expect.stringContaining('ctk_abc'),
      '1',
      'EX',
      // ~300 seconds — never a permanent entry that accumulates in Redis.
      expect.any(Number),
    );
    const ttl = client.set.mock.calls[0][3] as number;
    expect(ttl).toBeGreaterThan(290);
    expect(ttl).toBeLessThanOrEqual(301);
  });

  it('uses a minimum TTL for an already-expired token rather than a negative one', async () => {
    const { service, client } = makeService();
    await service.revoke('ctk_old', new Date(Date.now() - 10_000));
    expect(client.set.mock.calls[0][3]).toBeGreaterThanOrEqual(1);
  });
});
