import { ConfigService } from '@nestjs/config';
import { SignalingError } from '../signaling-error';
import { SignalingErrorCode } from '../signaling.constants';
import { makeSession } from '../testing/session.fixture';
import { RoomRegistryService } from './room-registry.service';

/**
 * A minimal in-memory stand-in for the ioredis calls RoomRegistryService
 * makes (smembers/sismember/multi().sadd/srem/set/del/expire().exec()).
 * No TTL simulation — these tests cover routing/membership logic, not
 * expiry, which is exercised for real against real Redis in
 * test/signaling.e2e-spec.ts.
 */
class FakeRedisClient {
  private readonly sets = new Map<string, Set<string>>();

  async smembers(key: string): Promise<string[]> {
    return Array.from(this.sets.get(key) ?? []);
  }

  async sismember(key: string, member: string): Promise<0 | 1> {
    return this.sets.get(key)?.has(member) ? 1 : 0;
  }

  multi() {
    const ops: Array<() => void> = [];
    const chain = {
      sadd: (key: string, member: string) => {
        ops.push(() => {
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
      expire: () => chain,
      set: () => chain,
      del: () => chain,
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
});
