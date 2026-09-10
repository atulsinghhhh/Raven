import { RedisService } from '../../shared/redis/redis.service';
import { RtcTokenRedisKeys, RtcTokenRevocationService } from './rtc-token-revocation.service';

function makeService(overrides: Partial<{ exists: jest.Mock; set: jest.Mock }> = {}): {
  service: RtcTokenRevocationService;
  client: { exists: jest.Mock; set: jest.Mock };
} {
  const client = {
    exists: overrides.exists ?? jest.fn().mockResolvedValue(0),
    set: overrides.set ?? jest.fn().mockResolvedValue('OK'),
  };
  return {
    service: new RtcTokenRevocationService({ client } as unknown as RedisService),
    client,
  };
}

describe('RtcTokenRedisKeys', () => {
  it('namespaces RTC revocations apart from chat', () => {
    // Token ids are minted independently on the two planes, so one shared
    // namespace would let a collision revoke the wrong credential.
    expect(RtcTokenRedisKeys.revokedToken('rtk_1')).toBe('raven:rtc:token:revoked:rtk_1');
    expect(RtcTokenRedisKeys.revokedToken('rtk_1')).not.toContain(':chat:');
  });
});

describe('revoke', () => {
  it('sets a tombstone that only outlives the token itself', async () => {
    const { service, client } = makeService();

    await service.revoke('rtk_abc', new Date(Date.now() + 300_000));

    expect(client.set).toHaveBeenCalledWith('raven:rtc:token:revoked:rtk_abc', '1', 'EX', expect.any(Number));
    // Bounded by the token's own remaining life, so revocation state can
    // never accumulate in Redis without a reaper.
    const ttl = client.set.mock.calls[0][3] as number;
    expect(ttl).toBeGreaterThan(290);
    expect(ttl).toBeLessThanOrEqual(301);
  });

  it('stores only the token id, never the token itself', async () => {
    // A dump of this keyspace must hand an attacker no working credential.
    const { service, client } = makeService();

    await service.revoke('rtk_abc', new Date(Date.now() + 60_000));

    const [key, value] = client.set.mock.calls[0] as [string, string];
    expect(key).toBe('raven:rtc:token:revoked:rtk_abc');
    expect(value).toBe('1');
  });

  it('does not write anything for an already-expired token', async () => {
    // It is refused for its expiry before revocation is consulted, so the
    // write would buy nothing.
    const { service, client } = makeService();

    await service.revoke('rtk_old', new Date(Date.now() - 10_000));

    expect(client.set).not.toHaveBeenCalled();
  });
});

describe('isRevoked', () => {
  it('reports a tombstoned token as revoked', async () => {
    const { service } = makeService({ exists: jest.fn().mockResolvedValue(1) });
    await expect(service.isRevoked('rtk_killed')).resolves.toBe(true);
  });

  it('reports a token with no tombstone as not revoked', async () => {
    const { service } = makeService({ exists: jest.fn().mockResolvedValue(0) });
    await expect(service.isRevoked('rtk_live')).resolves.toBe(false);
  });

  it('fails open when Redis is unreachable', async () => {
    // Deliberate: an outage must degrade revocation, not refuse every
    // valid token. Short TTLs bound the exposure. See the service docs.
    const { service } = makeService({
      exists: jest.fn().mockRejectedValue(new Error('redis down')),
    });
    await expect(service.isRevoked('rtk_killed')).resolves.toBe(false);
  });

  it('queries the namespaced key for the given token id', async () => {
    const exists = jest.fn().mockResolvedValue(0);
    const { service } = makeService({ exists });

    await service.isRevoked('rtk_xyz');

    expect(exists).toHaveBeenCalledWith('raven:rtc:token:revoked:rtk_xyz');
  });
});
