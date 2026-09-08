import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../../shared/redis/redis.service';
import { ChatErrorCode, ChatServerFrame, PresenceStatus, RedisKeys } from '../chat.constants';
import { ChatError } from '../chat-error';
import { ChatEventsService } from '../realtime/chat-events.service';

export interface PresenceEntry {
  userId: string;
  status: PresenceStatus;
}

/**
 * Presence, entirely in Redis (spec §20). Nothing here ever touches
 * Postgres: a user tabbing away and back would otherwise generate two
 * durable writes per switch, for state that is meaningless five seconds
 * later.
 *
 * The design is expiry-driven, not event-driven. A live connection
 * refreshes its key every CHAT_PRESENCE_REFRESH_MS, comfortably inside the
 * TTL; if the process holding that socket dies without cleaning up, the
 * key simply expires and the user goes offline on its own. That's what
 * makes a gateway crash a non-event for presence (spec §35/§52).
 *
 * Two keys per user, on purpose:
 *   - `raven:presence:{project}:{conv}:{user}`: the status value, TTL'd.
 *   - `raven:presence:index:{project}:{conv}`: a sorted set of
 *     userId -> expiry ms, so listing a room is one ZRANGEBYSCORE instead
 *     of a SCAN across the keyspace.
 */
@Injectable()
export class PresenceService {
  private readonly logger = new Logger(PresenceService.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
    private readonly events: ChatEventsService,
  ) {}

  private get ttlSeconds(): number {
    return this.configService.get<number>('chat.presenceTtlSeconds')!;
  }

  /**
   * Marks a user present and broadcasts only on an actual change;
   * heartbeat refreshes must not spam every participant with a presence
   * event every 20 seconds (spec §59, "avoid unnecessary broadcasts").
   */
  async set(
    projectId: string,
    conversationId: string,
    conversationPublicId: string,
    userId: string,
    status: PresenceStatus,
  ): Promise<void> {
    const key = RedisKeys.presence(projectId, conversationId, userId);
    const indexKey = RedisKeys.presenceIndex(projectId, conversationId);
    const expiresAt = Date.now() + this.ttlSeconds * 1000;

    let previous: string | null = null;
    try {
      previous = await this.redisService.client.get(key);
      await this.redisService.client
        .multi()
        .set(key, status, 'EX', this.ttlSeconds)
        .zadd(indexKey, expiresAt, userId)
        // The index outlives any single member so a rejoin doesn't have to
        // recreate it, but it still can't linger forever.
        .expire(indexKey, this.ttlSeconds * 4)
        .exec();
    } catch (err) {
      // Presence is a nice-to-have. A Redis outage degrades it to
      // "nobody appears online", never to "chat is broken" (spec §52).
      this.logger.warn(`presence write failed: ${(err as Error).message}`);
      return;
    }

    if (previous !== status) {
      await this.publish(projectId, conversationId, conversationPublicId, userId, status);
    }
  }

  /** Explicit offline (a clean disconnect). Expiry covers the unclean ones. */
  async clear(
    projectId: string,
    conversationId: string,
    conversationPublicId: string,
    userId: string,
  ): Promise<void> {
    try {
      await this.redisService.client
        .multi()
        .del(RedisKeys.presence(projectId, conversationId, userId))
        .zrem(RedisKeys.presenceIndex(projectId, conversationId), userId)
        .exec();
    } catch (err) {
      this.logger.warn(`presence clear failed: ${(err as Error).message}`);
      return;
    }
    await this.publish(projectId, conversationId, conversationPublicId, userId, PresenceStatus.OFFLINE);
  }

  /**
   * Everyone currently present. Prunes expired index entries in the same
   * pass: cheaper than a background sweeper, and it self-heals whenever
   * anyone actually looks.
   */
  async list(projectId: string, conversationId: string): Promise<PresenceEntry[]> {
    const indexKey = RedisKeys.presenceIndex(projectId, conversationId);
    const now = Date.now();

    try {
      await this.redisService.client.zremrangebyscore(indexKey, '-inf', now);
      const userIds = await this.redisService.client.zrangebyscore(indexKey, now, '+inf');
      if (userIds.length === 0) {
        return [];
      }

      const statuses = await this.redisService.client.mget(
        ...userIds.map((userId) => RedisKeys.presence(projectId, conversationId, userId)),
      );

      return userIds
        .map((userId, index) => ({ userId, raw: statuses[index] }))
        // A null status means the value key expired ahead of the index
        // entry: treat that as gone, don't invent an "online".
        .filter((entry): entry is { userId: string; raw: string } => entry.raw !== null)
        .map(({ userId, raw }) => ({ userId, status: raw as PresenceStatus }));
    } catch (err) {
      this.logger.warn(`presence read failed: ${(err as Error).message}`);
      throw new ChatError(ChatErrorCode.INTERNAL_ERROR, 'Presence is temporarily unavailable');
    }
  }

  private async publish(
    projectId: string,
    conversationId: string,
    conversationPublicId: string,
    userId: string,
    status: PresenceStatus,
  ): Promise<void> {
    await this.events.publish(projectId, conversationId, {
      type: ChatServerFrame.PRESENCE,
      conversationId,
      roomId: conversationPublicId,
      userId,
      status,
      at: new Date().toISOString(),
    });
  }
}
