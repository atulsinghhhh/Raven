import { ConfigService } from '@nestjs/config';
import { SignalingError } from '../signaling-error';
import { SIGNALING_PARTICIPANT_TTL_SECONDS, SignalingErrorCode } from '../signaling.constants';
import { makeSession } from '../testing/session.fixture';
import { RoomRegistryService } from './room-registry.service';

/**
 * A minimal in-memory stand-in for the ioredis calls RoomRegistryService
 * makes (smembers/sismember/multi().sadd/srem/set/del/expire().exec()).
 *
 * TTL is simulated against an injectable clock rather than real elapsed
 * time, so a test can jump the clock 200 seconds forward instantly instead
 * of actually sleeping. `expire()` mirrors real Redis precisely where it
 * matters for this bug: it is a no-op on a key that doesn't exist (or
 * already lapsed) — it never resurrects one, only re-arms a countdown on
 * one that's still there.
 */
class FakeRedisClient {
  private readonly sets = new Map<string, Set<string>>();
  private readonly expiresAt = new Map<string, number>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  private prune(key: string): void {
    const exp = this.expiresAt.get(key);
    if (exp !== undefined && exp <= this.now()) {
      this.sets.delete(key);
      this.expiresAt.delete(key);
    }
  }

  async smembers(key: string): Promise<string[]> {
    this.prune(key);
    return Array.from(this.sets.get(key) ?? []);
  }

  async sismember(key: string, member: string): Promise<0 | 1> {
    this.prune(key);
    return this.sets.get(key)?.has(member) ? 1 : 0;
  }

  async scard(key: string): Promise<number> {
    this.prune(key);
    return this.sets.get(key)?.size ?? 0;
  }

  multi() {
    const ops: Array<() => void> = [];
    const chain = {
      sadd: (key: string, member: string) => {
        ops.push(() => {
          this.prune(key);
          const set = this.sets.get(key) ?? new Set<string>();
          set.add(member);
          this.sets.set(key, set);
        });
        return chain;
      },
      srem: (key: string, member: string) => {
        ops.push(() => this.sets.get(key)?.delete(member));
        return chain;
      },
      expire: (key: string, seconds: number) => {
        ops.push(() => {
          this.prune(key);
          // Real EXPIRE on a missing key returns 0 and creates nothing.
          if (this.sets.has(key)) {
            this.expiresAt.set(key, this.now() + seconds * 1000);
          }
        });
        return chain;
      },
      set: () => chain,
      del: (key: string) => {
        ops.push(() => {
          this.sets.delete(key);
          this.expiresAt.delete(key);
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

describe('RoomRegistryService', () => {
  let registry: RoomRegistryService;
  let maxParticipants: number;

  beforeEach(() => {
    maxParticipants = 3;
    const configService = { get: jest.fn(() => maxParticipants) } as unknown as ConfigService;
    const redisService = { client: new FakeRedisClient() } as never;
    registry = new RoomRegistryService(configService, redisService);
  });

  it('returns no existing participants for the first joiner', async () => {
    const { existingParticipantIds, wasReconnect } = await registry.join(makeSession({ participantId: 'alice' }));
    expect(existingParticipantIds).toEqual([]);
    expect(wasReconnect).toBe(false);
  });

  it('returns previously-joined participant ids (excluding self) to a later joiner', async () => {
    await registry.join(makeSession({ participantId: 'alice' }));
    await registry.join(makeSession({ participantId: 'bob' }));

    const { existingParticipantIds } = await registry.join(makeSession({ participantId: 'carol' }));
    expect(existingParticipantIds.slice().sort()).toEqual(['alice', 'bob']);
  });

  it('reports a reconnect (same participantId) instead of duplicating the slot', async () => {
    const first = makeSession({ participantId: 'alice', connectionId: 'conn-old' });
    await registry.join(first);

    const second = makeSession({ participantId: 'alice', connectionId: 'conn-new' });
    const { wasReconnect } = await registry.join(second);

    expect(wasReconnect).toBe(true);
    expect(registry.listParticipants('room-1')).toHaveLength(1);
    expect(registry.get('room-1', 'alice')).toBe(second);
  });

  it('rejects joining once the room is at its configured capacity', async () => {
    await registry.join(makeSession({ participantId: 'a' }));
    await registry.join(makeSession({ participantId: 'b' }));
    await registry.join(makeSession({ participantId: 'c' }));

    await expect(registry.join(makeSession({ participantId: 'd' }))).rejects.toThrow(SignalingError);
    try {
      await registry.join(makeSession({ participantId: 'd' }));
    } catch (err) {
      expect((err as SignalingError).code).toBe(SignalingErrorCode.ROOM_FULL);
    }
  });

  it('does not count a reconnect (same participantId) against room capacity', async () => {
    await registry.join(makeSession({ participantId: 'a' }));
    await registry.join(makeSession({ participantId: 'b' }));
    await registry.join(makeSession({ participantId: 'c' }));

    // Room's "full" at 3, but 'a' rejoining should still succeed since it
    // replaces its own slot instead of requesting a new one.
    await expect(registry.join(makeSession({ participantId: 'a', connectionId: 'conn-2' }))).resolves.toBeDefined();
  });

  it('removes a participant on leave and cleans up an emptied room', async () => {
    await registry.join(makeSession({ participantId: 'alice' }));
    const removed = await registry.leave('room-1', 'alice');

    expect(removed?.participantId).toBe('alice');
    expect(registry.get('room-1', 'alice')).toBeUndefined();
    expect(registry.getMetrics()).toEqual({ activeRooms: 0, activeParticipants: 0 });
  });

  it('leave is a safe no-op for a participant/room that never existed', async () => {
    await expect(registry.leave('ghost-room', 'ghost-participant')).resolves.toBeNull();
  });

  it('tracks aggregate local-instance metrics across multiple rooms', async () => {
    await registry.join(makeSession({ participantId: 'a', roomId: 'room-1' }));
    await registry.join(makeSession({ participantId: 'b', roomId: 'room-1' }));
    await registry.join(makeSession({ participantId: 'c', roomId: 'room-2' }));

    expect(registry.getMetrics()).toEqual({ activeRooms: 2, activeParticipants: 3 });
  });

  describe('existsFleetWide', () => {
    it('is true for a participant registered in the room, even one not held locally', async () => {
      await registry.join(makeSession({ participantId: 'alice', roomId: 'room-1' }));
      await expect(registry.existsFleetWide('room-1', 'alice')).resolves.toBe(true);
    });

    it('is false for a participant never joined, or scoped to a different room', async () => {
      await registry.join(makeSession({ participantId: 'alice', roomId: 'room-1' }));
      await expect(registry.existsFleetWide('room-1', 'ghost')).resolves.toBe(false);
      await expect(registry.existsFleetWide('room-2', 'alice')).resolves.toBe(false);
    });

    it('fails closed when the fleet-wide check itself errors', async () => {
      const configService = { get: jest.fn(() => 50) } as unknown as ConfigService;
      const failingClient = {
        sismember: jest.fn().mockRejectedValue(new Error('redis down')),
      };
      const failingRegistry = new RoomRegistryService(configService, { client: failingClient } as never);

      await expect(failingRegistry.existsFleetWide('room-1', 'alice')).resolves.toBe(false);
    });
  });

  /**
   * The P0 this fix addresses: `join()` sets a TTL, but nothing used to
   * re-arm it while a participant just sat there connected. These tests
   * jump a fake clock instead of sleeping — real elapsed time isn't what
   * matters, the countdown crossing zero is.
   */
  describe('refresh (heartbeat TTL keep-alive)', () => {
    function makeRegistry(clock: { now: number }) {
      const configService = { get: jest.fn(() => 100) } as unknown as ConfigService;
      const client = new FakeRedisClient(() => clock.now);
      return new RoomRegistryService(configService, { client } as never);
    }

    // Test A: a participant kept alive by refresh survives past the
    // original TTL boundary.
    it('keeps a participant in the fleet view past the original TTL when refreshed before it lapses', async () => {
      const clock = { now: 0 };
      const registry = makeRegistry(clock);
      await registry.join(makeSession({ participantId: 'alice', roomId: 'room-1' }));

      // Refresh shortly before the TTL would have lapsed...
      clock.now += (SIGNALING_PARTICIPANT_TTL_SECONDS - 5) * 1000;
      await registry.refresh('room-1', 'alice');

      // ...and again well past where the *original* TTL would have expired.
      clock.now += (SIGNALING_PARTICIPANT_TTL_SECONDS - 5) * 1000;
      await expect(registry.existsFleetWide('room-1', 'alice')).resolves.toBe(true);
    });

    it('without a refresh, a participant falls out of the fleet view once the TTL lapses (documents the bug this fixes)', async () => {
      const clock = { now: 0 };
      const registry = makeRegistry(clock);
      await registry.join(makeSession({ participantId: 'alice', roomId: 'room-1' }));

      clock.now += (SIGNALING_PARTICIPANT_TTL_SECONDS + 1) * 1000;

      await expect(registry.existsFleetWide('room-1', 'alice')).resolves.toBe(false);
    });

    // Test B: a late joiner discovers a participant kept alive by refresh,
    // past the original TTL boundary.
    it('a late joiner sees an existing participant kept alive by refresh past the TTL boundary', async () => {
      const clock = { now: 0 };
      const registry = makeRegistry(clock);
      await registry.join(makeSession({ participantId: 'alice', roomId: 'room-1' }));

      for (let i = 0; i < 3; i++) {
        clock.now += (SIGNALING_PARTICIPANT_TTL_SECONDS - 10) * 1000;
        await registry.refresh('room-1', 'alice');
      }
      // Total elapsed time is now well past SIGNALING_PARTICIPANT_TTL_SECONDS
      // since alice's original join — this is the >120s boundary from the
      // real host/viewer repro.

      const { existingParticipantIds } = await registry.join(makeSession({ participantId: 'carol', roomId: 'room-1' }));
      expect(existingParticipantIds).toEqual(['alice']);
    });

    // Test F: a late joiner discovers multiple existing participants, all
    // kept alive by their own refreshes.
    it('a late joiner discovers multiple existing participants kept alive by refresh', async () => {
      const clock = { now: 0 };
      const registry = makeRegistry(clock);
      await registry.join(makeSession({ participantId: 'alice', roomId: 'room-1' }));
      await registry.join(makeSession({ participantId: 'bob', roomId: 'room-1' }));

      // Refresh both, before the TTL lapses, repeatedly — same as a real
      // heartbeat tick every HEARTBEAT_INTERVAL_MS, well short of the TTL.
      for (let i = 0; i < 3; i++) {
        clock.now += (SIGNALING_PARTICIPANT_TTL_SECONDS - 10) * 1000;
        await registry.refresh('room-1', 'alice');
        await registry.refresh('room-1', 'bob');
      }

      const { existingParticipantIds } = await registry.join(makeSession({ participantId: 'carol', roomId: 'room-1' }));
      expect(existingParticipantIds.slice().sort()).toEqual(['alice', 'bob']);
    });

    // Test E: disconnect behavior — refresh must not resurrect or outlive
    // an explicit leave.
    it('is a safe no-op for a participant with no local session (already disconnected)', async () => {
      const clock = { now: 0 };
      const registry = makeRegistry(clock);
      await registry.join(makeSession({ participantId: 'alice', roomId: 'room-1' }));
      await registry.leave('room-1', 'alice');

      await expect(registry.refresh('room-1', 'alice')).resolves.toBeUndefined();
      // Refresh did not resurrect the membership leave() just removed.
      await expect(registry.existsFleetWide('room-1', 'alice')).resolves.toBe(false);
    });

    it('leave still removes a participant even if refresh ran moments before', async () => {
      const clock = { now: 0 };
      const registry = makeRegistry(clock);
      await registry.join(makeSession({ participantId: 'alice', roomId: 'room-1' }));
      await registry.refresh('room-1', 'alice');

      await registry.leave('room-1', 'alice');

      await expect(registry.existsFleetWide('room-1', 'alice')).resolves.toBe(false);
    });

    it('does nothing for a room/participant that never joined', async () => {
      const clock = { now: 0 };
      const registry = makeRegistry(clock);

      await expect(registry.refresh('ghost-room', 'ghost-participant')).resolves.toBeUndefined();
      await expect(registry.existsFleetWide('ghost-room', 'ghost-participant')).resolves.toBe(false);
    });

    it('does not throw when the underlying refresh command fails', async () => {
      const configService = { get: jest.fn(() => 100) } as unknown as ConfigService;
      const failingChain = {
        expire: () => failingChain,
        exec: () => Promise.reject(new Error('redis down')),
      };
      const failingClient = { multi: () => failingChain };
      const registry = new RoomRegistryService(configService, { client: failingClient } as never);

      // refresh() checks its own local session map first, which requires
      // a real join — but the join itself must succeed even though this
      // same failing client will also reject join()'s own fleet write, by
      // the existing fail-open behavior `join()` already has.
      await registry.join(makeSession({ participantId: 'alice', roomId: 'room-1' }));

      await expect(registry.refresh('room-1', 'alice')).resolves.toBeUndefined();
    });
  });
});
