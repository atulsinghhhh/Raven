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
 * Wraps RoomServiceClient to answer "what's actually happening in the SFU
 * right now" — our Room row in Postgres is just a control-plane record,
 * it has no clue whether anyone's actually connected. This is where that
 * gap gets closed for the dashboard.
 *
 * Gotcha: LiveKit's listRooms([name]) returns nothing for a room with
 * zero participants — rooms just disappear once empty. That's the "idle"
 * case, and callers need to tell it apart from "SFU unreachable", so
 * both are handled separately below.
 */
@Injectable()
export class LiveKitRoomService {
  private readonly logger = new Logger(LiveKitRoomService.name);
  private readonly client: RoomServiceClient;

  constructor(private readonly configService: ConfigService) {
    // internalUrl, not url — runs server-side, inside the same Docker
    // network as LiveKit (see the internalUrl comment in configuration.ts).
    this.client = new RoomServiceClient(
      this.configService.get<string>('livekit.internalUrl')!,
      this.configService.get<string>('livekit.apiKey'),
      this.configService.get<string>('livekit.apiSecret'),
    );
  }

  /**
   * Live participant counts per room name. A name missing from the map
   * means the room's empty or doesn't exist in LiveKit — both render as
   * "0 participants", which is fine either way. Returns undefined (not a
   * partial map) if LiveKit itself couldn't be reached, so callers can
   * tell "idle" apart from "unknown".
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
  // @livekit/protocol's TrackType enum: AUDIO = 0, VIDEO = 1, DATA = 2.
  if (type === 0) return 'audio';
  if (type === 1) return 'video';
  return 'unknown';
}
