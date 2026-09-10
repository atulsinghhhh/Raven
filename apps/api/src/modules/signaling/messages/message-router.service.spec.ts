import { ConfigService } from '@nestjs/config';
import { RtcServer, RtcServerStatus } from '../../../generated/prisma/client';
import { NoRtcCapacityError } from '../../rtc-servers/rtc-server-allocator.service';
import { RoomRegistryService } from '../rooms/room-registry.service';
import { RoomTrackRegistryService } from '../rooms/room-track-registry.service';
import { SignalingError } from '../signaling-error';
import { ClientMessageType, ServerMessageType, SignalingErrorCode } from '../signaling.constants';
import { NodeLinkMessageType } from '../sfu/node-link.interface';
import { makeSession, withPermissions } from '../testing/session.fixture';
import { MessageRouterService } from './message-router.service';

/** Same fake as room-registry.service.spec.ts: see that file's comment. */
class FakeRedisClient {
  private readonly sets = new Map<string, Set<string>>();
  private readonly hashes = new Map<string, Map<string, string>>();

  async smembers(key: string): Promise<string[]> {
    return Array.from(this.sets.get(key) ?? []);
  }

  async sismember(key: string, member: string): Promise<0 | 1> {
    return this.sets.get(key)?.has(member) ? 1 : 0;
  }

  async scard(key: string): Promise<number> {
    return this.sets.get(key)?.size ?? 0;
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return Object.fromEntries(this.hashes.get(key) ?? new Map());
  }

  async hkeys(key: string): Promise<string[]> {
    return Array.from((this.hashes.get(key) ?? new Map()).keys());
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

  async hget(key: string, field: string): Promise<string | null> {
    return this.hashes.get(key)?.get(field) ?? null;
  }

  async hset(key: string, field: string, value: string): Promise<number> {
    const hash = this.hashes.get(key) ?? new Map<string, string>();
    hash.set(field, value);
    this.hashes.set(key, hash);
    return 1;
  }

  async del(key: string): Promise<number> {
    return this.hashes.delete(key) || this.sets.delete(key) ? 1 : 0;
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
      hset: (key: string, field: string, value: string) => {
        ops.push(() => {
          const hash = this.hashes.get(key) ?? new Map<string, string>();
          hash.set(field, value);
          this.hashes.set(key, hash);
        });
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

function makeServer(overrides: Partial<RtcServer> = {}): RtcServer {
  return {
    id: 'srv-1',
    name: 'sfu-local-01',
    region: 'local',
    status: RtcServerStatus.HEALTHY,
    publicHost: 'localhost',
    internalUrl: 'http://sfu:7000',
    capacity: 100,
    activeRooms: 0,
    activeParticipants: 0,
    cpuPercent: null,
    memoryPercent: null,
    networkInBps: null,
    networkOutBps: null,
    version: '0.1.0',
    lastHeartbeatAt: new Date(),
    registeredAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as RtcServer;
}

describe('MessageRouterService', () => {
  let router: MessageRouterService;
  let registry: RoomRegistryService;
  let allocator: {
    allocate: jest.Mock;
    assignedServerFor: jest.Mock;
    serverById: jest.Mock;
    releaseRoom: jest.Mock;
  };
  let sfuLink: { send: jest.Mock; trySend: jest.Mock; releaseSession: jest.Mock };
  let usageAllowances: { checkProject: jest.Mock };
  let usageMeter: { startSession: jest.Mock; settle: jest.Mock };
  let prisma: { room: { findUnique: jest.Mock } };
  let server: RtcServer;

  beforeEach(() => {
    const configService = { get: jest.fn(() => 50) } as unknown as ConfigService;
    const redisService = { client: new FakeRedisClient() } as never;
    registry = new RoomRegistryService(configService, redisService);
    const trackRegistry = new RoomTrackRegistryService(redisService);

    server = makeServer();
    allocator = {
      allocate: jest.fn().mockResolvedValue(server),
      assignedServerFor: jest.fn().mockResolvedValue(server),
      serverById: jest.fn().mockResolvedValue(server),
      releaseRoom: jest.fn().mockResolvedValue(undefined),
    };
    sfuLink = {
      send: jest.fn().mockResolvedValue(undefined),
      trySend: jest.fn().mockResolvedValue(true),
      releaseSession: jest.fn(),
    };

    // Metering is wired into join/leave but is not what this suite is
    // about: an allowance with room left, and a meter that records calls.
    // Its own behaviour is covered in usage-meter.service.spec.ts.
    usageAllowances = {
      checkProject: jest.fn().mockResolvedValue({ allowance: { id: 'ua1' }, exhausted: false, blocked: false }),
    };
    usageMeter = {
      startSession: jest.fn().mockResolvedValue({ id: 'us1' }),
      settle: jest.fn().mockResolvedValue(null),
    };

    // A room that is open. The closed case gets its own test below.
    prisma = { room: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) } };

    router = new MessageRouterService(
      prisma as never,
      registry,
      trackRegistry,
      allocator as never,
      sfuLink as never,
      usageAllowances as never,
      usageMeter as never,
    );
  });

  describe('room.join', () => {
    it('rejects a participant without join permission', async () => {
      const session = withPermissions(makeSession(), { join: false });

      await expect(router.route(session, { type: ClientMessageType.ROOM_JOIN })).rejects.toMatchObject({
        code: SignalingErrorCode.PERMISSION_DENIED,
      });
      expect(allocator.allocate).not.toHaveBeenCalled();
    });

    it('rejects a roomId that disagrees with the token', async () => {
      // The signed token authorizes the room; a field in the message
      // must never be able to override it (spec §38).
      const session = makeSession();

      await expect(
        router.route(session, { type: ClientMessageType.ROOM_JOIN, roomId: 'someone-elses-room' }),
      ).rejects.toMatchObject({ code: SignalingErrorCode.UNAUTHORIZED });
      expect(allocator.allocate).not.toHaveBeenCalled();
    });

    /**
     * Closing a room evicts everyone, which the SDK reads as a dropped
     * socket and answers by reconnecting. Its token was minted before the
     * close and is still perfectly valid, so without this the eviction
     * lasted about a second and the room carried on.
     */
    it('refuses to let anyone into a CLOSED room, however valid their token', async () => {
      prisma.room.findUnique.mockResolvedValue({ status: 'CLOSED' });

      await expect(router.route(makeSession(), { type: ClientMessageType.ROOM_JOIN })).rejects.toMatchObject({
        code: SignalingErrorCode.ROOM_CLOSED,
      });
      expect(allocator.allocate).not.toHaveBeenCalled();
      expect(sfuLink.send).not.toHaveBeenCalled();
    });

    it('allocates a server, registers the participant, and asks the node for a PeerConnection', async () => {
      const session = makeSession();

      const result = await router.route(session, { type: ClientMessageType.ROOM_JOIN });

      expect(allocator.allocate).toHaveBeenCalledWith('room-1', undefined);
      expect(session.joinedRoom).toBe(true);
      expect(session.rtcServerName).toBe('sfu-local-01');

      const frame = sfuLink.send.mock.calls[0][1];
      expect(frame.type).toBe(NodeLinkMessageType.PARTICIPANT_ADD);
      expect(frame.sessionId).toBe('conn-1');
      expect(frame.roomId).toBe('room-1');
      expect(frame.payload.participantId).toBe('alice');
      expect(frame.payload.permissions).toEqual({
        publish: true,
        subscribe: true,
        publishAudio: true,
        publishVideo: true,
        publishData: true,
      });

      expect(result.toSender).toMatchObject({
        type: ServerMessageType.ROOM_JOINED,
        roomId: 'room-1',
        rtcServer: 'sfu-local-01',
        region: 'local',
      });
    });

    it('passes a requested region through to the allocator', async () => {
      await router.route(makeSession(), { type: ClientMessageType.ROOM_JOIN, region: 'asia-south' });
      expect(allocator.allocate).toHaveBeenCalledWith('room-1', 'asia-south');
    });

    it('never tells the client the server address, only its name', async () => {
      // A client that learned an SFU's address could connect to it
      // directly, and then the media plane could not be changed without
      // breaking that client.
      const result = await router.route(makeSession(), { type: ClientMessageType.ROOM_JOIN });

      const serialized = JSON.stringify(result.toSender);
      expect(serialized).not.toContain('sfu:7000');
      expect(serialized).not.toContain('localhost');
    });

    it('announces the join to the rest of the room', async () => {
      const result = await router.route(makeSession(), { type: ClientMessageType.ROOM_JOIN });

      expect(result.toRoom).toMatchObject({
        roomId: 'room-1',
        excludeParticipantId: 'alice',
        message: { type: ServerMessageType.PARTICIPANT_JOINED },
      });
    });

    it('refuses the join when the account has spent its included minutes', async () => {
      usageAllowances.checkProject.mockResolvedValue({
        allowance: { id: 'ua1' },
        exhausted: true,
        blocked: true,
      });

      await expect(router.route(makeSession(), { type: ClientMessageType.ROOM_JOIN })).rejects.toMatchObject({
        code: SignalingErrorCode.USAGE_LIMIT_EXCEEDED,
      });
      // Refused before anything is allocated: an exhausted account must
      // not pin an SFU it will never use.
      expect(allocator.allocate).not.toHaveBeenCalled();
      expect(usageMeter.startSession).not.toHaveBeenCalled();
    });

    it('admits the join when the allowance is spent but enforcement is off', async () => {
      usageAllowances.checkProject.mockResolvedValue({
        allowance: { id: 'ua1' },
        exhausted: true,
        blocked: false,
      });

      await expect(router.route(makeSession(), { type: ClientMessageType.ROOM_JOIN })).resolves.toBeDefined();
      // Still metered — a self-hoster who does not cap themselves still
      // wants the figures.
      expect(usageMeter.startSession).toHaveBeenCalled();
    });

    it('opens the usage meter with server-side state only', async () => {
      await router.route(makeSession(), { type: ClientMessageType.ROOM_JOIN });

      expect(usageMeter.startSession).toHaveBeenCalledWith({
        // The gateway's own connection id, never anything from the client.
        sessionKey: 'conn-1',
        projectId: 'project-1',
        environment: 'DEVELOPMENT',
        roomId: 'room-1',
        roomName: 'demo-room',
        participantIdentity: 'alice',
      });
    });

    it('does not open a meter for a join the node refused', async () => {
      sfuLink.send.mockRejectedValue(new Error('node unreachable'));

      await expect(router.route(makeSession(), { type: ClientMessageType.ROOM_JOIN })).rejects.toMatchObject({
        code: SignalingErrorCode.RTC_SERVER_UNREACHABLE,
      });
      expect(usageMeter.startSession).not.toHaveBeenCalled();
    });

    it('lets the join succeed when metering itself fails', async () => {
      // A database blip must not take down calling. Under-counting on a
      // Livqeno fault is the right side to err on.
      usageMeter.startSession.mockRejectedValue(new Error('database down'));

      await expect(router.route(makeSession(), { type: ClientMessageType.ROOM_JOIN })).resolves.toMatchObject({
        toSender: { type: ServerMessageType.ROOM_JOINED },
      });
    });

    it('reports no capacity as a distinct, actionable error', async () => {
      allocator.allocate.mockRejectedValue(new NoRtcCapacityError('asia-south'));

      await expect(router.route(makeSession(), { type: ClientMessageType.ROOM_JOIN })).rejects.toMatchObject({
        code: SignalingErrorCode.NO_RTC_CAPACITY,
      });
    });

    it('rolls the registration back when the node is unreachable', async () => {
      // A participant the node never learned about must not be counted in
      // the room, or the next joiner is told about someone who will never
      // publish anything.
      sfuLink.send.mockRejectedValue(new Error('connect ECONNREFUSED'));
      const session = makeSession();

      await expect(router.route(session, { type: ClientMessageType.ROOM_JOIN })).rejects.toMatchObject({
        code: SignalingErrorCode.RTC_SERVER_UNREACHABLE,
      });

      expect(session.joinedRoom).toBe(false);
      expect(session.rtcServerId).toBeUndefined();
      await expect(registry.countFleetWide('room-1')).resolves.toBe(0);
    });

    it('includes what existing participants are already publishing', async () => {
      // So a client joining a call in progress renders the room in one
      // pass, rather than filling an empty grid from a stream of events.
      const bob = makeSession({ connectionId: 'conn-bob', participantId: 'bob' });
      await router.route(bob, { type: ClientMessageType.ROOM_JOIN });

      const trackRegistry = (router as unknown as { trackRegistry: RoomTrackRegistryService }).trackRegistry;
      await trackRegistry.publish('room-1', 'bob', {
        trackId: 'bob-cam',
        kind: 'video',
        source: 'camera',
        muted: false,
        simulcast: true,
        layers: ['low', 'high'],
      });

      const result = await router.route(makeSession(), { type: ClientMessageType.ROOM_JOIN });

      const joined = result.toSender as { participants: { id: string; tracks?: unknown[] }[] };
      const bobEntry = joined.participants.find((p) => p.id === 'bob');
      expect(bobEntry?.tracks).toEqual([
        {
          trackId: 'bob-cam',
          kind: 'video',
          source: 'camera',
          muted: false,
          simulcast: true,
          layers: ['low', 'high'],
        },
      ]);
    });

    it('kicks a stale session only on a genuine reconnect', async () => {
      const first = makeSession({ connectionId: 'conn-1' });
      const firstResult = await router.route(first, { type: ClientMessageType.ROOM_JOIN });
      expect(firstResult.kickParticipant).toBeUndefined();

      const reconnect = makeSession({ connectionId: 'conn-2' });
      const secondResult = await router.route(reconnect, { type: ClientMessageType.ROOM_JOIN });
      expect(secondResult.kickParticipant).toEqual({
        roomId: 'room-1',
        participantId: 'alice',
        exceptConnectionId: 'conn-2',
      });
    });
  });

  describe('negotiation relay', () => {
    it('rejects an answer from a session that has not joined', async () => {
      await expect(
        router.route(makeSession(), { type: ClientMessageType.SDP_ANSWER, sdp: 'v=0...' }),
      ).rejects.toMatchObject({ code: SignalingErrorCode.NOT_IN_ROOM });
    });

    it('relays an answer to the node serving the room', async () => {
      const session = makeSession();
      await router.route(session, { type: ClientMessageType.ROOM_JOIN });
      sfuLink.send.mockClear();

      const result = await router.route(session, {
        type: ClientMessageType.SDP_ANSWER,
        sdp: 'v=0 answer',
      });

      const [target, frame] = sfuLink.send.mock.calls[0];
      expect(target.name).toBe('sfu-local-01');
      expect(frame.type).toBe(NodeLinkMessageType.SDP_ANSWER);
      expect(frame.sessionId).toBe('conn-1');
      expect(frame.payload).toEqual({ sdp: 'v=0 answer', type: 'answer' });
      // Nothing goes back to the client: the node answers asynchronously.
      expect(result).toEqual({});
    });

    it('relays a client-initiated offer as a distinct frame type', async () => {
      // Named distinctly from the SFU's own offer so a frame's direction
      // is unambiguous from its type alone.
      const session = makeSession();
      await router.route(session, { type: ClientMessageType.ROOM_JOIN });
      sfuLink.send.mockClear();

      await router.route(session, { type: ClientMessageType.SDP_OFFER, sdp: 'v=0 offer' });

      expect(sfuLink.send.mock.calls[0][1].type).toBe(NodeLinkMessageType.SDP_OFFER_FROM_CLIENT);
    });

    it('refuses a client offer without publish permission', async () => {
      // A client only offers in order to publish.
      const session = withPermissions(makeSession(), { publish: false });
      await router.route(session, { type: ClientMessageType.ROOM_JOIN });
      sfuLink.send.mockClear();

      await expect(
        router.route(session, { type: ClientMessageType.SDP_OFFER, sdp: 'v=0 offer' }),
      ).rejects.toMatchObject({ code: SignalingErrorCode.PERMISSION_DENIED });
      expect(sfuLink.send).not.toHaveBeenCalled();
    });

    it('relays an ICE candidate with all of its addressing fields', async () => {
      const session = makeSession();
      await router.route(session, { type: ClientMessageType.ROOM_JOIN });
      sfuLink.send.mockClear();

      await router.route(session, {
        type: ClientMessageType.ICE_CANDIDATE,
        candidate: 'candidate:1 1 udp 2130706431 10.0.0.1 54321 typ host',
        sdpMid: '0',
        sdpMLineIndex: 0,
        usernameFragment: 'abc123',
      });

      expect(sfuLink.send.mock.calls[0][1].payload).toEqual({
        candidate: 'candidate:1 1 udp 2130706431 10.0.0.1 54321 typ host',
        sdpMid: '0',
        sdpMLineIndex: 0,
        usernameFragment: 'abc123',
      });
    });

    it('surfaces an unreachable node so the client can retry', async () => {
      // Losing an answer or a candidate stalls the connection silently,
      // so unlike a mute this failure has to reach the client.
      const session = makeSession();
      await router.route(session, { type: ClientMessageType.ROOM_JOIN });
      sfuLink.send.mockRejectedValue(new Error('socket closed'));

      await expect(router.route(session, { type: ClientMessageType.SDP_ANSWER, sdp: 'v=0' })).rejects.toMatchObject({
        code: SignalingErrorCode.RTC_SERVER_UNREACHABLE,
      });
    });

    it('fails a relay when the room has no assigned server', async () => {
      const session = makeSession();
      await router.route(session, { type: ClientMessageType.ROOM_JOIN });
      allocator.serverById.mockResolvedValue(null);
      allocator.assignedServerFor.mockResolvedValue(null);

      await expect(router.route(session, { type: ClientMessageType.SDP_ANSWER, sdp: 'v=0' })).rejects.toMatchObject({
        code: SignalingErrorCode.RTC_SERVER_UNREACHABLE,
      });
    });
  });

  describe('track.mute', () => {
    it('tells the node and the room, without unpublishing', async () => {
      const session = makeSession();
      await router.route(session, { type: ClientMessageType.ROOM_JOIN });

      const result = await router.route(session, {
        type: ClientMessageType.TRACK_MUTE,
        trackId: 'alice-cam',
        muted: true,
      });

      const frame = sfuLink.trySend.mock.calls[0][1];
      expect(frame.type).toBe(NodeLinkMessageType.TRACK_MUTE);
      expect(frame.payload).toEqual({ trackId: 'alice-cam', muted: true });

      // A muted track is still published: the transceiver stays, so
      // unmuting is immediate and the subscriber keeps the tile.
      expect(result.toRoom?.message).toEqual({
        type: ServerMessageType.TRACK_MUTED,
        participantId: 'alice',
        trackId: 'alice-cam',
      });
    });

    it('reports an unmute distinctly from a publish', async () => {
      const session = makeSession();
      await router.route(session, { type: ClientMessageType.ROOM_JOIN });

      const result = await router.route(session, {
        type: ClientMessageType.TRACK_MUTE,
        trackId: 'alice-cam',
        muted: false,
      });

      expect(result.toRoom?.message).toMatchObject({ type: ServerMessageType.TRACK_UNMUTED });
    });
  });

  describe('subscription.update', () => {
    it('forwards the requested layer without confirming it', async () => {
      // The layer delivered depends on what the publisher is sending;
      // confirming here would let a UI claim a quality it may not be
      // receiving (spec §19).
      const session = makeSession();
      await router.route(session, { type: ClientMessageType.ROOM_JOIN });

      const result = await router.route(session, {
        type: ClientMessageType.SUBSCRIPTION_UPDATE,
        publisherId: 'bob',
        trackId: 'bob-cam',
        layer: 'low',
      });

      expect(sfuLink.trySend.mock.calls[0][1].payload).toEqual({
        publisherId: 'bob',
        trackId: 'bob-cam',
        layer: 'low',
      });
      expect(result).toEqual({});
    });

    it('requires subscribe permission', async () => {
      const session = withPermissions(makeSession(), { subscribe: false });
      await router.route(session, { type: ClientMessageType.ROOM_JOIN });

      await expect(
        router.route(session, {
          type: ClientMessageType.SUBSCRIPTION_UPDATE,
          publisherId: 'bob',
          trackId: 'bob-cam',
          layer: 'high',
        }),
      ).rejects.toMatchObject({ code: SignalingErrorCode.PERMISSION_DENIED });
    });
  });

  describe('room.leave', () => {
    it('removes the participant from the node and the room', async () => {
      const session = makeSession();
      await router.route(session, { type: ClientMessageType.ROOM_JOIN });
      sfuLink.trySend.mockClear();

      const result = await router.route(session, { type: ClientMessageType.ROOM_LEAVE });

      expect(sfuLink.trySend.mock.calls[0][1].type).toBe(NodeLinkMessageType.PARTICIPANT_REMOVE);
      expect(sfuLink.releaseSession).toHaveBeenCalledWith('conn-1');
      expect(session.joinedRoom).toBe(false);
      expect(result.toSender).toEqual({ type: ServerMessageType.ROOM_LEFT, roomId: 'room-1' });
      expect(result.toRoom?.message).toMatchObject({ type: ServerMessageType.PARTICIPANT_LEFT });
    });

    it('closes the usage meter for the leaving participant', async () => {
      const session = makeSession();
      await router.route(session, { type: ClientMessageType.ROOM_JOIN });

      await router.route(session, { type: ClientMessageType.ROOM_LEAVE });

      expect(usageMeter.settle).toHaveBeenCalledWith('conn-1', { close: 'left' });
    });

    it('still completes the leave when settling the meter fails', async () => {
      // A failed settle leaves a live row the reaper closes at its last
      // confirmed-alive instant; it must not strand the participant in a
      // room they have left.
      const session = makeSession();
      await router.route(session, { type: ClientMessageType.ROOM_JOIN });
      usageMeter.settle.mockRejectedValue(new Error('database down'));

      await expect(router.route(session, { type: ClientMessageType.ROOM_LEAVE })).resolves.toMatchObject({
        toSender: { type: ServerMessageType.ROOM_LEFT },
      });
      expect(session.joinedRoom).toBe(false);
    });

    it("releases the room's server assignment once the last participant leaves", async () => {
      // Keeping a stale assignment would pin an empty room to a node that
      // may since have been drained or replaced.
      const session = makeSession();
      await router.route(session, { type: ClientMessageType.ROOM_JOIN });
      await router.route(session, { type: ClientMessageType.ROOM_LEAVE });

      expect(allocator.releaseRoom).toHaveBeenCalledWith('room-1');
    });

    it('keeps the assignment while others are still in the room', async () => {
      const alice = makeSession({ connectionId: 'conn-a', participantId: 'alice' });
      const bob = makeSession({ connectionId: 'conn-b', participantId: 'bob' });
      await router.route(alice, { type: ClientMessageType.ROOM_JOIN });
      await router.route(bob, { type: ClientMessageType.ROOM_JOIN });

      await router.route(alice, { type: ClientMessageType.ROOM_LEAVE });

      expect(allocator.releaseRoom).not.toHaveBeenCalled();
    });

    it('rejects leaving before joining', async () => {
      await expect(router.route(makeSession(), { type: ClientMessageType.ROOM_LEAVE })).rejects.toBeInstanceOf(
        SignalingError,
      );
    });
  });

  describe('ping', () => {
    it('pongs without needing a room', async () => {
      const result = await router.route(makeSession(), { type: ClientMessageType.PING });
      expect(result).toEqual({ toSender: { type: ServerMessageType.PONG } });
    });
  });
});
