import { SIGNALING_PARTICIPANT_TTL_SECONDS } from '../signaling.constants';
import { RoomTrackRegistryService } from './room-track-registry.service';

/**
 * A minimal in-memory stand-in for the ioredis hash calls
 * RoomTrackRegistryService makes. Same TTL-simulation approach as
 * room-registry.service.spec.ts's FakeRedisClient: an injectable clock so a
 * test can jump forward in time instantly instead of sleeping, and
 * `expire()` mirrors real Redis by never creating a hash that doesn't
 * already exist.
 */
class FakeRedisClient {
  private readonly hashes = new Map<string, Map<string, string>>();
  private readonly expiresAt = new Map<string, number>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  private prune(key: string): void {
    const exp = this.expiresAt.get(key);
    if (exp !== undefined && exp <= this.now()) {
      this.hashes.delete(key);
      this.expiresAt.delete(key);
    }
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    this.prune(key);
    return Object.fromEntries(this.hashes.get(key) ?? new Map());
  }

  async hkeys(key: string): Promise<string[]> {
    this.prune(key);
    return Array.from((this.hashes.get(key) ?? new Map()).keys());
  }

  async hget(key: string, field: string): Promise<string | null> {
    this.prune(key);
    return this.hashes.get(key)?.get(field) ?? null;
  }

  async hset(key: string, field: string, value: string): Promise<number> {
    this.prune(key);
    const hash = this.hashes.get(key) ?? new Map<string, string>();
    hash.set(field, value);
    this.hashes.set(key, hash);
    return 1;
  }

  async hdel(key: string, ...fields: string[]): Promise<number> {
    const hash = this.hashes.get(key);
    if (!hash) return 0;
    let removed = 0;
    for (const field of fields) {
      if (hash.delete(field)) removed++;
    }
    return removed;
  }

  async del(key: string): Promise<number> {
    const existed = this.hashes.delete(key);
    this.expiresAt.delete(key);
    return existed ? 1 : 0;
  }

  /** Direct (non-multi) EXPIRE, matching how refreshTtl() calls it. */
  async expire(key: string, seconds: number): Promise<0 | 1> {
    this.prune(key);
    if (!this.hashes.has(key)) {
      return 0;
    }
    this.expiresAt.set(key, this.now() + seconds * 1000);
    return 1;
  }

  multi() {
    const ops: Array<() => void> = [];
    const chain = {
      hset: (key: string, field: string, value: string) => {
        ops.push(() => {
          this.prune(key);
          const hash = this.hashes.get(key) ?? new Map<string, string>();
          hash.set(field, value);
          this.hashes.set(key, hash);
        });
        return chain;
      },
      expire: (key: string, seconds: number) => {
        ops.push(() => {
          this.prune(key);
          if (this.hashes.has(key)) {
            this.expiresAt.set(key, this.now() + seconds * 1000);
          }
        });
        return chain;
      },
      exec: async () => {
        for (const op of ops) op();
        return [];
      },
    };
    return chain;
  }
}

describe('RoomTrackRegistryService', () => {
  function makeRegistry(clock: { now: number }) {
    const client = new FakeRedisClient(() => clock.now);
    return { registry: new RoomTrackRegistryService({ client } as never), client };
  }

  it('records a published track and returns it grouped by participant', async () => {
    const clock = { now: 0 };
    const { registry } = makeRegistry(clock);

    await registry.publish('room-1', 'alice', { trackId: 't1', kind: 'video', source: 'camera', muted: false, simulcast: false });

    const byParticipant = await registry.listByParticipant('room-1');
    expect(byParticipant.get('alice')).toEqual([{ trackId: 't1', kind: 'video', source: 'camera', muted: false, simulcast: false }]);
  });

  describe('refreshTtl (heartbeat keep-alive)', () => {
    it('keeps a room’s track list past the original TTL when refreshed before it lapses', async () => {
      const clock = { now: 0 };
      const { registry } = makeRegistry(clock);
      await registry.publish('room-1', 'alice', { trackId: 't1', kind: 'video', source: 'camera', muted: false, simulcast: false });

      clock.now += (SIGNALING_PARTICIPANT_TTL_SECONDS - 5) * 1000;
      await registry.refreshTtl('room-1');

      clock.now += (SIGNALING_PARTICIPANT_TTL_SECONDS - 5) * 1000;
      const byParticipant = await registry.listByParticipant('room-1');
      expect(byParticipant.get('alice')).toHaveLength(1);
    });

    it('without a refresh, the track list falls out once the TTL lapses (documents the bug this fixes)', async () => {
      const clock = { now: 0 };
      const { registry } = makeRegistry(clock);
      await registry.publish('room-1', 'alice', { trackId: 't1', kind: 'video', source: 'camera', muted: false, simulcast: false });

      clock.now += (SIGNALING_PARTICIPANT_TTL_SECONDS + 1) * 1000;

      const byParticipant = await registry.listByParticipant('room-1');
      expect(byParticipant.has('alice')).toBe(false);
    });

    it('is a safe no-op for a room with no published tracks — it never creates the hash', async () => {
      const clock = { now: 0 };
      const { registry, client } = makeRegistry(clock);

      await expect(registry.refreshTtl('room-with-no-tracks')).resolves.toBeUndefined();
      await expect(client.hgetall('raven:signaling:room:room-with-no-tracks:tracks')).resolves.toEqual({});
    });

    it('does not throw when the underlying refresh command fails', async () => {
      const failingClient = { expire: () => Promise.reject(new Error('redis down')) };
      const registry = new RoomTrackRegistryService({ client: failingClient } as never);

      await expect(registry.refreshTtl('room-1')).resolves.toBeUndefined();
    });
  });
});
