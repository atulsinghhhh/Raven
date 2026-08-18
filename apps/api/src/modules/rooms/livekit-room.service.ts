import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RoomServiceClient } from 'livekit-server-sdk';

export interface LiveTrackInfo {
  sid: string;
  kind: 'audio' | 'video' | 'unknown';
  name: string;
  muted: boolean;
}

export interface LiveParticipantInfo {
  identity: string;
  joinedAt: Date;
  tracks: LiveTrackInfo[];
}

export interface LiveRoomInfo {
  numParticipants: number;
  participants: LiveParticipantInfo[];
}

/**
 * Wraps livekit-server-sdk's RoomServiceClient to answer "what's actually
 * happening in the SFU right now" — Raven's own Room row in Postgres is
 * just a control-plane record (Phase 2); it has no idea whether anyone is
 * actually connected. This is the one place that gap gets closed for the
 * dashboard (Phase 7 spec §6/§12/§13 — no fake metrics).
 *
 * LiveKit's `listRooms([name])` returns nothing for a room with zero
 * current participants (rooms disappear once empty), which is exactly
 * the "0 live, idle" case the dashboard needs to distinguish from "SFU
 * unreachable" — the two are handled differently by callers.
 */
@Injectable()
export class LiveKitRoomService {
  private readonly logger = new Logger(LiveKitRoomService.name);
  private readonly client: RoomServiceClient;

  constructor(private readonly configService: ConfigService) {
    // internalUrl, not url: this runs server-side, inside the same Docker
    // network as LiveKit itself — see configuration.ts's comment on
    // livekit.internalUrl for why these two must stay distinct.
    this.client = new RoomServiceClient(
      this.configService.get<string>('livekit.internalUrl')!,
      this.configService.get<string>('livekit.apiKey'),
      this.configService.get<string>('livekit.apiSecret'),
    );
  }

  /**
   * Live participant counts for a set of room names, keyed by name.
   * A name absent from the returned map means either the room is
   * currently empty or does not exist in LiveKit — both render as
   * "0 participants" to the caller, which is correct either way.
   * Returns `undefined` (not a partial map) if LiveKit itself could not
   * be reached, so callers can distinguish "idle" from "unknown".
   */
  async listLiveParticipantCounts(roomNames: string[]): Promise<Map<string, number> | undefined> {
    if (roomNames.length === 0) return new Map();
    try {
      const rooms = await this.client.listRooms(roomNames);
      return new Map(rooms.map((room) => [room.name, room.numParticipants]));
    } catch (error) {
      this.logger.warn(`could not reach LiveKit to list live rooms: ${(error as Error).message}`);
      return undefined;
    }
  }

  /**
   * Live participants (with published tracks) for one room. Returns
   * `undefined` if LiveKit could not be reached; an empty array means the
   * room is genuinely idle right now.
   */
  async listLiveParticipants(roomName: string): Promise<LiveParticipantInfo[] | undefined> {
    try {
      const participants = await this.client.listParticipants(roomName);
      return participants.map((p) => ({
        identity: p.identity,
        joinedAt: new Date(Number(p.joinedAtMs)),
        tracks: p.tracks.map((t) => ({
          sid: t.sid,
          kind: trackKind(t.type),
          name: t.name,
          muted: t.muted,
        })),
      }));
    } catch (error) {
      this.logger.warn(`could not reach LiveKit to list participants for "${roomName}": ${(error as Error).message}`);
      return undefined;
    }
  }
}

function trackKind(type: number): 'audio' | 'video' | 'unknown' {
  // TrackType enum from @livekit/protocol: AUDIO = 0, VIDEO = 1, DATA = 2.
  if (type === 0) return 'audio';
  if (type === 1) return 'video';
  return 'unknown';
}
