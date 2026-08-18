import { ConfigService } from '@nestjs/config';
import { ParticipantSession } from '../interfaces/participant-session.interface';
import { SignalingError } from '../signaling-error';
import { SignalingErrorCode } from '../signaling.constants';
import { RoomRegistryService } from './room-registry.service';

function makeSession(overrides: Partial<ParticipantSession>): ParticipantSession {
  return {
    connectionId: 'conn-1',
    participantId: 'alice',
    projectId: 'project-1',
    roomId: 'room-1',
    permissions: { join: true, subscribe: true, publish: true, publishAudio: true, publishVideo: true, publishData: true },
    socket: {} as never,
    joinedRoom: false,
    joinedAt: null,
    isAlive: true,
    messageTimestamps: [],
    ...overrides,
  };
}

describe('RoomRegistryService', () => {
  let registry: RoomRegistryService;
  let maxParticipants: number;

  beforeEach(() => {
    maxParticipants = 3;
    const configService = { get: jest.fn(() => maxParticipants) } as unknown as ConfigService;
    registry = new RoomRegistryService(configService);
  });

  it('returns no existing participants for the first joiner', () => {
    const { existingParticipants, replaced } = registry.join(makeSession({ participantId: 'alice' }));
    expect(existingParticipants).toEqual([]);
    expect(replaced).toBeNull();
  });

  it('returns previously-joined participants (excluding self) to a later joiner', () => {
    registry.join(makeSession({ participantId: 'alice' }));
    registry.join(makeSession({ participantId: 'bob' }));

    const { existingParticipants } = registry.join(makeSession({ participantId: 'carol' }));
    expect(existingParticipants.map((p) => p.participantId).sort()).toEqual(['alice', 'bob']);
  });

  it('replaces a stale session for the same participantId instead of duplicating it', () => {
    const first = makeSession({ participantId: 'alice', connectionId: 'conn-old' });
    registry.join(first);

    const second = makeSession({ participantId: 'alice', connectionId: 'conn-new' });
    const { replaced } = registry.join(second);

    expect(replaced).toBe(first);
    expect(registry.listParticipants('room-1')).toHaveLength(1);
    expect(registry.get('room-1', 'alice')).toBe(second);
  });

  it('rejects joining once the room is at its configured capacity', () => {
    registry.join(makeSession({ participantId: 'a' }));
    registry.join(makeSession({ participantId: 'b' }));
    registry.join(makeSession({ participantId: 'c' }));

    expect(() => registry.join(makeSession({ participantId: 'd' }))).toThrow(SignalingError);
    try {
      registry.join(makeSession({ participantId: 'd' }));
    } catch (err) {
      expect((err as SignalingError).code).toBe(SignalingErrorCode.ROOM_FULL);
    }
  });

  it('does not count a reconnect (same participantId) against room capacity', () => {
    registry.join(makeSession({ participantId: 'a' }));
    registry.join(makeSession({ participantId: 'b' }));
    registry.join(makeSession({ participantId: 'c' }));

    // Room is "full" at 3, but 'a' rejoining must still succeed — it
    // replaces its own slot rather than requesting a new one.
    expect(() => registry.join(makeSession({ participantId: 'a', connectionId: 'conn-2' }))).not.toThrow();
  });

  it('removes a participant on leave and cleans up an emptied room', () => {
    registry.join(makeSession({ participantId: 'alice' }));
    const removed = registry.leave('room-1', 'alice');

    expect(removed?.participantId).toBe('alice');
    expect(registry.get('room-1', 'alice')).toBeUndefined();
    expect(registry.getMetrics()).toEqual({ activeRooms: 0, activeParticipants: 0 });
  });

  it('leave is a safe no-op for a participant/room that never existed', () => {
    expect(registry.leave('ghost-room', 'ghost-participant')).toBeNull();
  });

  it('tracks aggregate metrics across multiple rooms', () => {
    registry.join(makeSession({ participantId: 'a', roomId: 'room-1' }));
    registry.join(makeSession({ participantId: 'b', roomId: 'room-1' }));
    registry.join(makeSession({ participantId: 'c', roomId: 'room-2' }));

    expect(registry.getMetrics()).toEqual({ activeRooms: 2, activeParticipants: 3 });
  });
});
