import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../../shared/redis/redis.service';
import { PublicTrack } from '../interfaces/signaling-message.interface';
import { SIGNALING_PARTICIPANT_TTL_SECONDS } from '../signaling.constants';

const trackKey = (roomId: string) => `raven:signaling:room:${roomId}:tracks`;
const fieldFor = (participantId: string, trackId: string) => `${participantId}/${trackId}`;

interface StoredTrack extends PublicTrack {
  participantId: string;
}

/**
 * What is currently being published in each room, fleet-wide.
 *
 * # Why this exists at all
 *
 * The SFU is the source of truth: it knows what is on the wire, and it can
 * be asked (`room.state`). But answering `room.joined` from the SFU would
 * make joining a call wait on a request/response round trip over the node
 * link, and it would only ever be answerable by the instance holding that
 * link.
 *
 * So this is a cache, maintained from the `track.published` /
 * `track.unpublished` frames the SFU already sends. It exists to let a
 * client joining a call in progress render the room in one pass instead of
 * showing an empty grid and filling it in from a stream of events it must
 * distinguish from genuinely new ones.
 *
 * # It is a cache, and treated like one
 *
 * A missed frame or a Redis blip leaves it stale. That is survivable
 * precisely because it is not authoritative: the SFU's offer to the
 * joining participant contains the real track set, so media arrives
 * correctly even if this list was wrong, and the next `track.published`
 * corrects it. Nothing here is ever used to decide whether to forward
 * media.
 */
@Injectable()
export class RoomTrackRegistryService {
  private readonly logger = new Logger(RoomTrackRegistryService.name);

  constructor(private readonly redisService: RedisService) {}

  async publish(roomId: string, participantId: string, track: PublicTrack): Promise<void> {
    const stored: StoredTrack = { ...track, participantId };
    try {
      await this.redisService.client
        .multi()
        .hset(trackKey(roomId), fieldFor(participantId, track.trackId), JSON.stringify(stored))
        // TTL'd for the same reason the participant set is: an instance
        // that dies mid-call must not leave a room advertising tracks
        // forever.
        .expire(trackKey(roomId), SIGNALING_PARTICIPANT_TTL_SECONDS)
        .exec();
    } catch (err) {
      this.logger.warn(`could not record track ${track.trackId} in room ${roomId}: ${(err as Error).message}`);
    }
  }

  async unpublish(roomId: string, participantId: string, trackId: string): Promise<void> {
    try {
      await this.redisService.client.hdel(trackKey(roomId), fieldFor(participantId, trackId));
    } catch (err) {
      this.logger.warn(`could not clear track ${trackId} in room ${roomId}: ${(err as Error).message}`);
    }
  }

  async setMuted(roomId: string, participantId: string, trackId: string, muted: boolean): Promise<void> {
    const field = fieldFor(participantId, trackId);
    try {
      const raw = await this.redisService.client.hget(trackKey(roomId), field);
      if (!raw) {
        return;
      }
      const stored = JSON.parse(raw) as StoredTrack;
      stored.muted = muted;
      await this.redisService.client.hset(trackKey(roomId), field, JSON.stringify(stored));
    } catch (err) {
      this.logger.warn(`could not update mute for ${trackId} in room ${roomId}: ${(err as Error).message}`);
    }
  }

  /**
   * Drops everything a departing participant was publishing.
   *
   * Done as one read-then-delete rather than relying on the SFU to send an
   * unpublish per track: a participant whose process died sends nothing,
   * and the SFU's own unpublish events may race with the disconnect.
   */
  async clearParticipant(roomId: string, participantId: string): Promise<void> {
    try {
      const fields = await this.redisService.client.hkeys(trackKey(roomId));
      const owned = fields.filter((field) => field.startsWith(`${participantId}/`));
      if (owned.length > 0) {
        await this.redisService.client.hdel(trackKey(roomId), ...owned);
      }
    } catch (err) {
      this.logger.warn(
        `could not clear tracks for participant ${participantId} in room ${roomId}: ${(err as Error).message}`,
      );
    }
  }

  /** Tracks per participant, for building `room.joined`. */
  async listByParticipant(roomId: string): Promise<Map<string, PublicTrack[]>> {
    const byParticipant = new Map<string, PublicTrack[]>();

    let entries: Record<string, string>;
    try {
      entries = await this.redisService.client.hgetall(trackKey(roomId));
    } catch (err) {
      // An empty list is the right degradation: the joining client learns
      // the real track set from the SFU's offer regardless, and every
      // subsequent publish arrives as an event.
      this.logger.warn(`could not read tracks for room ${roomId}: ${(err as Error).message}`);
      return byParticipant;
    }

    for (const raw of Object.values(entries)) {
      let stored: StoredTrack;
      try {
        stored = JSON.parse(raw) as StoredTrack;
      } catch {
        continue;
      }
      const { participantId, ...track } = stored;
      const existing = byParticipant.get(participantId) ?? [];
      existing.push(track);
      byParticipant.set(participantId, existing);
    }

    return byParticipant;
  }

  /** Drops the whole room's track list: used when a room is closed. */
  async clearRoom(roomId: string): Promise<void> {
    try {
      await this.redisService.client.del(trackKey(roomId));
    } catch (err) {
      this.logger.warn(`could not clear tracks for room ${roomId}: ${(err as Error).message}`);
    }
  }
}
