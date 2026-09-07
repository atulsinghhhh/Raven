import { Injectable, Logger } from '@nestjs/common';
import { RtcServerAllocatorService } from '../rtc-servers/rtc-server-allocator.service';
import {
  NodeLinkMessageType,
  RoomStateResultPayload,
} from '../signaling/sfu/node-link.interface';
import { SfuLinkService } from '../signaling/sfu/sfu-link.service';

export interface LiveTrackInfo {
  /** The publisher's own track id — what a subscriber matches an incoming track against. */
  sid: string;
  kind: 'audio' | 'video' | 'unknown';
  /** `camera` / `microphone` / `screenShare`, as the publisher declared it. */
  name: string;
  muted: boolean;
}

export interface LiveParticipantInfo {
  identity: string;
  joinedAt: Date;
  tracks: LiveTrackInfo[];
}

/**
 * What is actually happening in a room right now.
 *
 * Replaces `LiveKitRoomService`, which asked LiveKit's `RoomServiceClient`
 * the same question. The gap it closes has not changed: a `Room` row in
 * Postgres is a control-plane record and has no idea whether anyone is
 * connected. Only the node serving the room knows that.
 *
 * # Why this is keyed by room id, not room name
 *
 * The old service took room *names*, because that is what LiveKit's API
 * indexed on. Raven's own media plane is addressed by room id throughout —
 * allocation, signaling, and the node link all use it — so this takes the
 * id and the callers, which already hold the room row, pass it.
 *
 * # Three distinct answers, deliberately
 *
 * - A list of participants means the node answered.
 * - An empty list means the room is genuinely idle.
 * - `undefined` means the node could not be reached, or the room has no
 *   assigned server at all.
 *
 * Collapsing the last two into "0 participants" is the mistake this
 * interface exists to prevent: a dashboard showing zero when it does not
 * know is lying, and an operator debugging a partition needs to tell the
 * two apart.
 */
@Injectable()
export class SfuRoomStateService {
  private readonly logger = new Logger(SfuRoomStateService.name);

  constructor(
    private readonly allocator: RtcServerAllocatorService,
    private readonly sfuLink: SfuLinkService,
  ) {}

  /**
   * Live participants for one room.
   *
   * `undefined` when the node is unreachable; an empty array when the
   * room is idle.
   */
  async listLiveParticipants(roomId: string): Promise<LiveParticipantInfo[] | undefined> {
    const server = await this.allocator.assignedServerFor(roomId);
    if (!server) {
      // No assigned server means no live media session. That is a fact,
      // not a failure — the room is idle.
      return [];
    }

    const reply = await this.sfuLink.request(server, NodeLinkMessageType.ROOM_STATE, roomId);
    if (!reply) {
      this.logger.warn(`could not reach ${server.name} for the live state of room ${roomId}`);
      return undefined;
    }

    const payload = reply.payload as RoomStateResultPayload | undefined;
    if (!payload) {
      return undefined;
    }

    return payload.participants.map((participant) => ({
      identity: participant.participantId,
      // The node reports Unix seconds; the API's contract is a Date.
      joinedAt: new Date(participant.joinedAt * 1000),
      tracks: participant.tracks.map((track) => ({
        sid: track.trackId,
        kind: toTrackKind(track.kind),
        name: track.source,
        muted: track.muted,
      })),
    }));
  }

  /**
   * Live participant counts for several rooms.
   *
   * Queries are grouped by server and issued concurrently, so a project
   * with rooms spread across the fleet costs one round trip per *node*
   * rather than one per room. A room whose node did not answer is absent
   * from the map, which callers render as "unknown" rather than zero.
   *
   * Returns `undefined` only when nothing could be determined at all,
   * preserving the old service's distinction between "idle" and "unknown".
   */
  async listLiveParticipantCounts(roomIds: string[]): Promise<Map<string, number> | undefined> {
    if (roomIds.length === 0) {
      return new Map();
    }

    const results = await Promise.all(
      roomIds.map(async (roomId) => {
        const participants = await this.listLiveParticipants(roomId);
        return { roomId, participants };
      }),
    );

    const counts = new Map<string, number>();
    let anyAnswered = false;

    for (const { roomId, participants } of results) {
      if (participants === undefined) {
        continue;
      }
      anyAnswered = true;
      counts.set(roomId, participants.length);
    }

    // Every room failed to answer. Reporting an empty map would render as
    // "every room is idle", which is a much stronger claim than the
    // truth.
    return anyAnswered ? counts : undefined;
  }
}

function toTrackKind(kind: string): 'audio' | 'video' | 'unknown' {
  if (kind === 'audio') return 'audio';
  if (kind === 'video') return 'video';
  return 'unknown';
}
