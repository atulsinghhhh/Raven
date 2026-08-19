import { ConfigService } from '@nestjs/config';
import { ParticipantSession } from '../interfaces/participant-session.interface';
import { RoomRegistryService } from '../rooms/room-registry.service';
import { SignalingError } from '../signaling-error';
import { ClientMessageType, ServerMessageType, SignalingErrorCode } from '../signaling.constants';
import { MessageRouterService } from './message-router.service';

/** Same fake as room-registry.service.spec.ts — see that file's comment. */
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

describe('MessageRouterService', () => {
  let router: MessageRouterService;
  let registry: RoomRegistryService;

  beforeEach(() => {
    const configService = { get: jest.fn(() => 50) } as unknown as ConfigService;
    const redisService = { client: new FakeRedisClient() } as never;
    registry = new RoomRegistryService(configService, redisService);
    router = new MessageRouterService(registry);
  });

  describe('room.join', () => {
    it('rejects a participant without join permission', async () => {
      const session = makeSession({ permissions: { join: false, subscribe: true, publish: false, publishAudio: false, publishVideo: false, publishData: false } });
      await expect(router.route(session, { type: ClientMessageType.ROOM_JOIN })).rejects.toThrow(SignalingError);
      try {
        await router.route(session, { type: ClientMessageType.ROOM_JOIN });
      } catch (err) {
        expect((err as SignalingError).code).toBe(SignalingErrorCode.PERMISSION_DENIED);
      }
    });

    it('rejects a roomId in the message that disagrees with the token-bound room', async () => {
      const session = makeSession({ roomId: 'room-1' });
      await expect(
        router.route(session, { type: ClientMessageType.ROOM_JOIN, roomId: 'room-999' }),
      ).rejects.toThrow(SignalingError);
    });

    it('marks the session joined and returns existing participant ids to the sender', async () => {
      await registry.join(makeSession({ participantId: 'bob' }));
      const session = makeSession({ participantId: 'alice' });

      const result = await router.route(session, { type: ClientMessageType.ROOM_JOIN });

      expect(session.joinedRoom).toBe(true);
      expect(session.joinedAt).not.toBeNull();
      expect(result.toSender).toEqual({
        type: ServerMessageType.ROOM_JOINED,
        roomId: 'room-1',
        participants: [{ id: 'bob' }],
      });
    });

    it('describes a fleet-wide broadcast so existing participants learn a new one joined', async () => {
      await registry.join(makeSession({ participantId: 'bob' }));
      const aliceSession = makeSession({ participantId: 'alice' });

      const result = await router.route(aliceSession, { type: ClientMessageType.ROOM_JOIN });

      expect(result.toRoom).toEqual({
        roomId: 'room-1',
        excludeParticipantId: 'alice',
        message: { type: ServerMessageType.PARTICIPANT_JOINED, participant: { id: 'alice' } },
      });
    });

    it('does not describe a kick for an ordinary first join', async () => {
      const result = await router.route(makeSession({ participantId: 'alice' }), {
        type: ClientMessageType.ROOM_JOIN,
      });
      expect(result.kickParticipant).toBeUndefined();
    });

    it('describes a fleet-wide kick when the same participant reconnects', async () => {
      await router.route(makeSession({ participantId: 'alice', connectionId: 'old' }), {
        type: ClientMessageType.ROOM_JOIN,
      });

      const result = await router.route(makeSession({ participantId: 'alice', connectionId: 'new' }), {
        type: ClientMessageType.ROOM_JOIN,
      });

      expect(result.kickParticipant).toEqual({
        roomId: 'room-1',
        participantId: 'alice',
        exceptConnectionId: 'new',
      });
    });
  });

  describe('in-room requirement', () => {
    it('rejects room.leave before joining', async () => {
      const session = makeSession({ joinedRoom: false });
      await expect(router.route(session, { type: ClientMessageType.ROOM_LEAVE })).rejects.toThrow(SignalingError);
    });

    it('rejects sdp.offer before joining', async () => {
      const session = makeSession({ joinedRoom: false });
      await expect(
        router.route(session, { type: ClientMessageType.SDP_OFFER, targetParticipantId: 'bob', sdp: 'v=0' }),
      ).rejects.toThrow(SignalingError);
    });
  });

  describe('sdp and ice routing', () => {
    it('rejects targeting a participant not in the room', async () => {
      const session = makeSession({ participantId: 'alice', joinedRoom: true });
      await registry.join(session);

      await expect(
        router.route(session, {
          type: ClientMessageType.SDP_OFFER,
          targetParticipantId: 'ghost',
          sdp: 'v=0',
        }),
      ).rejects.toThrow(SignalingError);
      try {
        await router.route(session, { type: ClientMessageType.SDP_OFFER, targetParticipantId: 'ghost', sdp: 'v=0' });
      } catch (err) {
        expect((err as SignalingError).code).toBe(SignalingErrorCode.PARTICIPANT_NOT_FOUND);
      }
    });

    it('rejects targeting yourself', async () => {
      const session = makeSession({ participantId: 'alice', joinedRoom: true });
      await registry.join(session);

      await expect(
        router.route(session, {
          type: ClientMessageType.SDP_OFFER,
          targetParticipantId: 'alice',
          sdp: 'v=0',
        }),
      ).rejects.toThrow(SignalingError);
    });

    it('describes an sdp.offer relay to the target participant, tagged with the sender', async () => {
      const alice = makeSession({ participantId: 'alice', joinedRoom: true });
      const bob = makeSession({ participantId: 'bob', joinedRoom: true });
      await registry.join(alice);
      await registry.join(bob);

      const result = await router.route(alice, {
        type: ClientMessageType.SDP_OFFER,
        targetParticipantId: 'bob',
        sdp: 'v=0 offer',
      });

      expect(result.toParticipant).toEqual({
        roomId: 'room-1',
        targetParticipantId: 'bob',
        message: { type: ServerMessageType.SDP_OFFER, fromParticipantId: 'alice', sdp: 'v=0 offer' },
      });
      expect(result.toSender).toBeUndefined();
    });

    it('describes an sdp.answer relay the same way', async () => {
      const alice = makeSession({ participantId: 'alice', joinedRoom: true });
      const bob = makeSession({ participantId: 'bob', joinedRoom: true });
      await registry.join(alice);
      await registry.join(bob);

      const result = await router.route(bob, {
        type: ClientMessageType.SDP_ANSWER,
        targetParticipantId: 'alice',
        sdp: 'v=0 answer',
      });

      expect(result.toParticipant?.message).toEqual({
        type: ServerMessageType.SDP_ANSWER,
        fromParticipantId: 'bob',
        sdp: 'v=0 answer',
      });
    });

    it('describes an ice.candidate relay the same way, leaving the candidate untouched', async () => {
      const alice = makeSession({ participantId: 'alice', joinedRoom: true });
      const bob = makeSession({ participantId: 'bob', joinedRoom: true });
      await registry.join(alice);
      await registry.join(bob);

      const candidate = { candidate: 'candidate:1 1 UDP 1 1.2.3.4 5000 typ host', sdpMid: '0' };
      const result = await router.route(alice, {
        type: ClientMessageType.ICE_CANDIDATE,
        targetParticipantId: 'bob',
        candidate,
      });

      expect(result.toParticipant?.message).toEqual({
        type: ServerMessageType.ICE_CANDIDATE,
        fromParticipantId: 'alice',
        candidate,
      });
    });

    it('resolves a target that only exists fleet-wide (joined on a different instance sharing Redis)', async () => {
      const sharedRedis = { client: new FakeRedisClient() } as never;
      const configService = { get: jest.fn(() => 50) } as unknown as ConfigService;
      const instanceA = new RoomRegistryService(configService, sharedRedis);
      const instanceB = new RoomRegistryService(configService, sharedRedis);
      const routerA = new MessageRouterService(instanceA);

      const alice = makeSession({ participantId: 'alice', roomId: 'room-1', joinedRoom: true });
      const bob = makeSession({ participantId: 'bob', roomId: 'room-1', joinedRoom: true });
      // alice joins via instanceA, bob via instanceB — modelling two
      // gateway pods behind the same Redis. Neither instance holds the
      // other's session locally.
      await instanceA.join(alice);
      await instanceB.join(bob);

      const result = await routerA.route(alice, {
        type: ClientMessageType.SDP_OFFER,
        targetParticipantId: 'bob',
        sdp: 'v=0 offer',
      });

      expect(result.toParticipant).toEqual({
        roomId: 'room-1',
        targetParticipantId: 'bob',
        message: { type: ServerMessageType.SDP_OFFER, fromParticipantId: 'alice', sdp: 'v=0 offer' },
      });
    });

    it('cannot leak a candidate to a same-named participant in a different room', async () => {
      const aliceRoom1 = makeSession({ participantId: 'alice', roomId: 'room-1', joinedRoom: true });
      const bobRoom2 = makeSession({ participantId: 'bob', roomId: 'room-2', joinedRoom: true });
      await registry.join(aliceRoom1);
      await registry.join(bobRoom2);

      // bob only exists in room-2, so alice (room-1) targeting "bob"
      // should resolve nothing — lookup is scoped to alice's own room.
      await expect(
        router.route(aliceRoom1, {
          type: ClientMessageType.ICE_CANDIDATE,
          targetParticipantId: 'bob',
          candidate: {},
        }),
      ).rejects.toThrow(SignalingError);
    });
  });

  describe('room.leave', () => {
    it('clears joinedRoom and describes a fleet-wide leave notification', async () => {
      const alice = makeSession({ participantId: 'alice', joinedRoom: true });
      await registry.join(alice);

      const result = await router.route(alice, { type: ClientMessageType.ROOM_LEAVE });

      expect(alice.joinedRoom).toBe(false);
      expect(result.toSender).toEqual({ type: ServerMessageType.ROOM_LEFT, roomId: 'room-1' });
      expect(result.toRoom).toEqual({
        roomId: 'room-1',
        excludeParticipantId: 'alice',
        message: { type: ServerMessageType.PARTICIPANT_LEFT, participant: { id: 'alice' } },
      });
    });
  });

  describe('ping', () => {
    it('replies with pong without requiring room membership', async () => {
      const session = makeSession({ joinedRoom: false });
      const result = await router.route(session, { type: ClientMessageType.PING });
      expect(result.toSender).toEqual({ type: ServerMessageType.PONG });
    });
  });
});
