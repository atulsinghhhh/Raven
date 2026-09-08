import { RtcServer, RtcServerStatus } from '../../generated/prisma/client';
import { RtcServerAllocatorService } from '../rtc-servers/rtc-server-allocator.service';
import { NodeLinkMessageType } from '../signaling/sfu/node-link.interface';
import { SfuLinkService } from '../signaling/sfu/sfu-link.service';
import { SfuRoomStateService } from './sfu-room-state.service';

function makeServer(overrides: Partial<RtcServer> = {}): RtcServer {
  return {
    id: 'srv-1',
    name: 'sfu-local-01',
    region: 'local',
    status: RtcServerStatus.HEALTHY,
    publicHost: 'localhost',
    internalUrl: 'http://sfu:7000',
    capacity: 100,
    activeRooms: 1,
    activeParticipants: 2,
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

/**
 * The point of this service is a three-way answer: serving, idle, or
 * unknown, and most of these tests exist to pin that down. Collapsing
 * "we could not find out" into "nobody is here" is the mistake it was
 * written to prevent: a dashboard reporting zero during a partition tells
 * an operator every call has ended.
 */
describe('SfuRoomStateService', () => {
  let service: SfuRoomStateService;
  let allocator: { assignedServerFor: jest.Mock };
  let sfuLink: { request: jest.Mock };

  beforeEach(() => {
    allocator = { assignedServerFor: jest.fn().mockResolvedValue(makeServer()) };
    sfuLink = { request: jest.fn() };
    service = new SfuRoomStateService(
      allocator as unknown as RtcServerAllocatorService,
      sfuLink as unknown as SfuLinkService,
    );
  });

  describe('listLiveParticipants', () => {
    it('asks the room\'s assigned node for its state', async () => {
      sfuLink.request.mockResolvedValue({
        type: NodeLinkMessageType.ROOM_STATE_RESULT,
        payload: { roomId: 'room-1', participants: [] },
      });

      await service.listLiveParticipants('room-1');

      expect(allocator.assignedServerFor).toHaveBeenCalledWith('room-1');
      expect(sfuLink.request).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'sfu-local-01' }),
        NodeLinkMessageType.ROOM_STATE,
        'room-1',
      );
    });

    it('maps participants and tracks into the API\'s shape', async () => {
      const joinedAtUnix = 1_760_000_000;
      sfuLink.request.mockResolvedValue({
        type: NodeLinkMessageType.ROOM_STATE_RESULT,
        payload: {
          roomId: 'room-1',
          participants: [
            {
              participantId: 'alice',
              sessionId: 'conn-1',
              joinedAt: joinedAtUnix,
              peerState: 'connected',
              tracks: [
                {
                  trackId: 'alice-cam',
                  kind: 'video',
                  source: 'camera',
                  muted: false,
                  simulcast: true,
                },
                {
                  trackId: 'alice-mic',
                  kind: 'audio',
                  source: 'microphone',
                  muted: true,
                  simulcast: false,
                },
              ],
            },
          ],
        },
      });

      const participants = await service.listLiveParticipants('room-1');

      expect(participants).toEqual([
        {
          identity: 'alice',
          // The node reports Unix seconds; the API's contract is a Date.
          joinedAt: new Date(joinedAtUnix * 1000),
          tracks: [
            { sid: 'alice-cam', kind: 'video', name: 'camera', muted: false },
            { sid: 'alice-mic', kind: 'audio', name: 'microphone', muted: true },
          ],
        },
      ]);
    });

    it('reports an idle room as an empty list, not as unknown', async () => {
      // A room with no assigned server has no live media session. That is
      // a fact the control plane knows without asking anyone.
      allocator.assignedServerFor.mockResolvedValue(null);

      await expect(service.listLiveParticipants('room-1')).resolves.toEqual([]);
      expect(sfuLink.request).not.toHaveBeenCalled();
    });

    it('reports an unreachable node as undefined, not as an empty room', async () => {
      sfuLink.request.mockResolvedValue(null);

      await expect(service.listLiveParticipants('room-1')).resolves.toBeUndefined();
    });

    it('reports a reply with no payload as undefined', async () => {
      // A malformed reply is a failure to find out, not a finding.
      sfuLink.request.mockResolvedValue({ type: NodeLinkMessageType.ROOM_STATE_RESULT });

      await expect(service.listLiveParticipants('room-1')).resolves.toBeUndefined();
    });

    it('maps an unrecognised track kind to unknown rather than guessing', async () => {
      sfuLink.request.mockResolvedValue({
        type: NodeLinkMessageType.ROOM_STATE_RESULT,
        payload: {
          roomId: 'room-1',
          participants: [
            {
              participantId: 'alice',
              sessionId: 'conn-1',
              joinedAt: 1,
              peerState: 'connected',
              tracks: [
                { trackId: 't', kind: 'hologram', source: 'camera', muted: false, simulcast: false },
              ],
            },
          ],
        },
      });

      const participants = await service.listLiveParticipants('room-1');
      expect(participants?.[0].tracks[0].kind).toBe('unknown');
    });
  });

  describe('listLiveParticipantCounts', () => {
    it('returns an empty map for no rooms without asking anyone', async () => {
      await expect(service.listLiveParticipantCounts([])).resolves.toEqual(new Map());
      expect(sfuLink.request).not.toHaveBeenCalled();
    });

    it('counts participants per room, keyed by room id', async () => {
      allocator.assignedServerFor.mockResolvedValue(makeServer());
      sfuLink.request.mockImplementation((_server, _type, roomId: string) =>
        Promise.resolve({
          type: NodeLinkMessageType.ROOM_STATE_RESULT,
          payload: {
            roomId,
            participants:
              roomId === 'room-busy'
                ? [
                    { participantId: 'a', sessionId: 's1', joinedAt: 1, peerState: 'connected', tracks: [] },
                    { participantId: 'b', sessionId: 's2', joinedAt: 1, peerState: 'connected', tracks: [] },
                  ]
                : [],
          },
        }),
      );

      const counts = await service.listLiveParticipantCounts(['room-busy', 'room-idle']);

      expect(counts?.get('room-busy')).toBe(2);
      expect(counts?.get('room-idle')).toBe(0);
    });

    it('omits a room whose node did not answer, rather than reporting zero', async () => {
      // Absent from the map means "unknown". Zero would claim the room is
      // idle, which is a much stronger statement.
      sfuLink.request.mockImplementation((_server, _type, roomId: string) =>
        roomId === 'room-ok'
          ? Promise.resolve({
              type: NodeLinkMessageType.ROOM_STATE_RESULT,
              payload: { roomId, participants: [] },
            })
          : Promise.resolve(null),
      );

      const counts = await service.listLiveParticipantCounts(['room-ok', 'room-unreachable']);

      expect(counts?.has('room-ok')).toBe(true);
      expect(counts?.has('room-unreachable')).toBe(false);
    });

    it('returns undefined when no room could be determined at all', async () => {
      // An empty map would render as "every room is idle", which during a
      // full partition is exactly the wrong thing to tell an operator.
      sfuLink.request.mockResolvedValue(null);

      await expect(
        service.listLiveParticipantCounts(['room-1', 'room-2']),
      ).resolves.toBeUndefined();
    });

    it('counts an unassigned room as genuinely idle', async () => {
      allocator.assignedServerFor.mockResolvedValue(null);

      const counts = await service.listLiveParticipantCounts(['room-1']);

      expect(counts?.get('room-1')).toBe(0);
      expect(sfuLink.request).not.toHaveBeenCalled();
    });
  });
});
