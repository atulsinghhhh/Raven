import { ConfigService } from '@nestjs/config';
import { ParticipantSession } from '../interfaces/participant-session.interface';
import { RoomRegistryService } from '../rooms/room-registry.service';
import { SignalingError } from '../signaling-error';
import { ClientMessageType, ServerMessageType, SignalingErrorCode } from '../signaling.constants';
import { MessageRouterService } from './message-router.service';

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
    registry = new RoomRegistryService(configService);
    router = new MessageRouterService(registry);
  });

  describe('room.join', () => {
    it('rejects a participant without join permission', () => {
      const session = makeSession({ permissions: { join: false, subscribe: true, publish: false, publishAudio: false, publishVideo: false, publishData: false } });
      expect(() => router.route(session, { type: ClientMessageType.ROOM_JOIN })).toThrow(SignalingError);
      try {
        router.route(session, { type: ClientMessageType.ROOM_JOIN });
      } catch (err) {
        expect((err as SignalingError).code).toBe(SignalingErrorCode.PERMISSION_DENIED);
      }
    });

    it('rejects a roomId in the message that disagrees with the token-bound room', () => {
      const session = makeSession({ roomId: 'room-1' });
      expect(() =>
        router.route(session, { type: ClientMessageType.ROOM_JOIN, roomId: 'room-999' }),
      ).toThrow(SignalingError);
    });

    it('marks the session joined and returns existing participants to the sender', () => {
      registry.join(makeSession({ participantId: 'bob' }));
      const session = makeSession({ participantId: 'alice' });

      const result = router.route(session, { type: ClientMessageType.ROOM_JOIN });

      expect(session.joinedRoom).toBe(true);
      expect(session.joinedAt).not.toBeNull();
      expect(result.toSender).toEqual({
        type: ServerMessageType.ROOM_JOINED,
        roomId: 'room-1',
        participants: [{ id: 'bob' }],
      });
    });

    it('notifies existing participants that a new one joined', () => {
      const bobSession = makeSession({ participantId: 'bob' });
      registry.join(bobSession);
      const aliceSession = makeSession({ participantId: 'alice' });

      const result = router.route(aliceSession, { type: ClientMessageType.ROOM_JOIN });

      expect(result.toOthers).toEqual([
        {
          session: bobSession,
          message: { type: ServerMessageType.PARTICIPANT_JOINED, participant: { id: 'alice' } },
        },
      ]);
    });

    it('returns the previous session to kick when the same participant reconnects', () => {
      const oldSession = makeSession({ participantId: 'alice', connectionId: 'old' });
      router.route(oldSession, { type: ClientMessageType.ROOM_JOIN });

      const newSession = makeSession({ participantId: 'alice', connectionId: 'new' });
      const result = router.route(newSession, { type: ClientMessageType.ROOM_JOIN });

      expect(result.kick).toBe(oldSession);
    });
  });

  describe('in-room requirement', () => {
    it('rejects room.leave before joining', () => {
      const session = makeSession({ joinedRoom: false });
      expect(() => router.route(session, { type: ClientMessageType.ROOM_LEAVE })).toThrow(SignalingError);
    });

    it('rejects sdp.offer before joining', () => {
      const session = makeSession({ joinedRoom: false });
      expect(() =>
        router.route(session, { type: ClientMessageType.SDP_OFFER, targetParticipantId: 'bob', sdp: 'v=0' }),
      ).toThrow(SignalingError);
    });
  });

  describe('sdp and ice routing', () => {
    it('rejects targeting a participant not in the room', () => {
      const session = makeSession({ participantId: 'alice', joinedRoom: true });
      registry.join(session);

      expect(() =>
        router.route(session, {
          type: ClientMessageType.SDP_OFFER,
          targetParticipantId: 'ghost',
          sdp: 'v=0',
        }),
      ).toThrow(SignalingError);
      try {
        router.route(session, { type: ClientMessageType.SDP_OFFER, targetParticipantId: 'ghost', sdp: 'v=0' });
      } catch (err) {
        expect((err as SignalingError).code).toBe(SignalingErrorCode.PARTICIPANT_NOT_FOUND);
      }
    });

    it('rejects targeting yourself', () => {
      const session = makeSession({ participantId: 'alice', joinedRoom: true });
      registry.join(session);

      expect(() =>
        router.route(session, {
          type: ClientMessageType.SDP_OFFER,
          targetParticipantId: 'alice',
          sdp: 'v=0',
        }),
      ).toThrow(SignalingError);
    });

    it('routes an sdp.offer to the target participant, tagged with the sender', () => {
      const alice = makeSession({ participantId: 'alice', joinedRoom: true });
      const bob = makeSession({ participantId: 'bob', joinedRoom: true });
      registry.join(alice);
      registry.join(bob);

      const result = router.route(alice, {
        type: ClientMessageType.SDP_OFFER,
        targetParticipantId: 'bob',
        sdp: 'v=0 offer',
      });

      expect(result.toOthers).toEqual([
        {
          session: bob,
          message: { type: ServerMessageType.SDP_OFFER, fromParticipantId: 'alice', sdp: 'v=0 offer' },
        },
      ]);
      expect(result.toSender).toBeUndefined();
    });

    it('routes an sdp.answer the same way', () => {
      const alice = makeSession({ participantId: 'alice', joinedRoom: true });
      const bob = makeSession({ participantId: 'bob', joinedRoom: true });
      registry.join(alice);
      registry.join(bob);

      const result = router.route(bob, {
        type: ClientMessageType.SDP_ANSWER,
        targetParticipantId: 'alice',
        sdp: 'v=0 answer',
      });

      expect(result.toOthers?.[0].message).toEqual({
        type: ServerMessageType.SDP_ANSWER,
        fromParticipantId: 'bob',
        sdp: 'v=0 answer',
      });
    });

    it('routes an ice.candidate the same way, leaving the candidate untouched', () => {
      const alice = makeSession({ participantId: 'alice', joinedRoom: true });
      const bob = makeSession({ participantId: 'bob', joinedRoom: true });
      registry.join(alice);
      registry.join(bob);

      const candidate = { candidate: 'candidate:1 1 UDP 1 1.2.3.4 5000 typ host', sdpMid: '0' };
      const result = router.route(alice, {
        type: ClientMessageType.ICE_CANDIDATE,
        targetParticipantId: 'bob',
        candidate,
      });

      expect(result.toOthers?.[0].message).toEqual({
        type: ServerMessageType.ICE_CANDIDATE,
        fromParticipantId: 'alice',
        candidate,
      });
    });

    it('cannot leak a candidate to a same-named participant in a different room', () => {
      const aliceRoom1 = makeSession({ participantId: 'alice', roomId: 'room-1', joinedRoom: true });
      const bobRoom2 = makeSession({ participantId: 'bob', roomId: 'room-2', joinedRoom: true });
      registry.join(aliceRoom1);
      registry.join(bobRoom2);

      // bob only exists in room-2, so alice (room-1) targeting "bob"
      // should resolve nothing — lookup is scoped to alice's own room.
      expect(() =>
        router.route(aliceRoom1, {
          type: ClientMessageType.ICE_CANDIDATE,
          targetParticipantId: 'bob',
          candidate: {},
        }),
      ).toThrow(SignalingError);
    });
  });

  describe('room.leave', () => {
    it('notifies remaining participants and clears joinedRoom', () => {
      const alice = makeSession({ participantId: 'alice', joinedRoom: true });
      const bob = makeSession({ participantId: 'bob', joinedRoom: true });
      registry.join(alice);
      registry.join(bob);

      const result = router.route(alice, { type: ClientMessageType.ROOM_LEAVE });

      expect(alice.joinedRoom).toBe(false);
      expect(result.toSender).toEqual({ type: ServerMessageType.ROOM_LEFT, roomId: 'room-1' });
      expect(result.toOthers).toEqual([
        {
          session: bob,
          message: { type: ServerMessageType.PARTICIPANT_LEFT, participant: { id: 'alice' } },
        },
      ]);
    });
  });

  describe('ping', () => {
    it('replies with pong without requiring room membership', () => {
      const session = makeSession({ joinedRoom: false });
      const result = router.route(session, { type: ClientMessageType.PING });
      expect(result.toSender).toEqual({ type: ServerMessageType.PONG });
    });
  });
});
