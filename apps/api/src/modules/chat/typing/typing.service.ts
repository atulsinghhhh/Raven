import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../../shared/redis/redis.service';
import { ChatServerFrame, RedisKeys } from '../chat.constants';
import { ChatEventsService } from '../realtime/chat-events.service';

/**
 * Typing indicators (spec §21). Never persisted: a typing event is
 * meaningless seven seconds after it happens, and writing one to Postgres
 * per keystroke would be the single most wasteful thing in this system.
 *
 * The stale-indicator problem is solved by TTL, not by trusting
 * clients to send a stop: a browser that crashes mid-sentence, or whose
 * tab is closed, leaves a key that expires on its own. Clients also run
 * their own local timeout, so a dropped `typing.stopped` frame can't leave
 * a permanent "Alice is typing…" on screen either.
 */
@Injectable()
export class TypingService {
  private readonly logger = new Logger(TypingService.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
    private readonly events: ChatEventsService,
  ) {}

  private get ttlSeconds(): number {
    return this.configService.get<number>('chat.typingTtlSeconds')!;
  }

  /**
   * Refreshes the TTL every call, but only broadcasts on the transition
   * into "typing". A client keystroke-throttling to one call per second
   * shouldn't produce one fan-out per second to every participant.
   */
  async start(
    projectId: string,
    conversationId: string,
    conversationPublicId: string,
    userId: string,
    originConnectionId?: string,
  ): Promise<void> {
    const key = RedisKeys.typing(projectId, conversationId, userId);
    const indexKey = RedisKeys.typingIndex(projectId, conversationId);

    let wasAlreadyTyping = false;
    try {
      wasAlreadyTyping = (await this.redisService.client.exists(key)) === 1;
      await this.redisService.client
        .multi()
        .set(key, '1', 'EX', this.ttlSeconds)
        .zadd(indexKey, Date.now() + this.ttlSeconds * 1000, userId)
        .expire(indexKey, this.ttlSeconds * 4)
        .exec();
    } catch (err) {
      this.logger.warn(`typing write failed: ${(err as Error).message}`);
      return;
    }

    if (!wasAlreadyTyping) {
      await this.publish(ChatServerFrame.TYPING_STARTED, projectId, conversationId, conversationPublicId, userId, originConnectionId);
    }
  }

  async stop(
    projectId: string,
    conversationId: string,
    conversationPublicId: string,
    userId: string,
    originConnectionId?: string,
  ): Promise<void> {
    let wasTyping = false;
    try {
      const removed = await this.redisService.client.del(RedisKeys.typing(projectId, conversationId, userId));
      wasTyping = removed === 1;
      await this.redisService.client.zrem(RedisKeys.typingIndex(projectId, conversationId), userId);
    } catch (err) {
      this.logger.warn(`typing clear failed: ${(err as Error).message}`);
      return;
    }

    // Only announce a stop if there was a start to stop: otherwise a
    // client that fires stop on every blur floods the conversation.
    if (wasTyping) {
      await this.publish(ChatServerFrame.TYPING_STOPPED, projectId, conversationId, conversationPublicId, userId, originConnectionId);
    }
  }

  /** Who is currently typing, for a client that just joined mid-conversation. */
  async list(projectId: string, conversationId: string): Promise<string[]> {
    const indexKey = RedisKeys.typingIndex(projectId, conversationId);
    const now = Date.now();
    try {
      await this.redisService.client.zremrangebyscore(indexKey, '-inf', now);
      return await this.redisService.client.zrangebyscore(indexKey, now, '+inf');
    } catch (err) {
      this.logger.warn(`typing read failed: ${(err as Error).message}`);
      return [];
    }
  }

  private async publish(
    type: ChatServerFrame.TYPING_STARTED | ChatServerFrame.TYPING_STOPPED,
    projectId: string,
    conversationId: string,
    conversationPublicId: string,
    userId: string,
    originConnectionId?: string,
  ): Promise<void> {
    await this.events.publish(
      projectId,
      conversationId,
      { type, conversationId, roomId: conversationPublicId, userId },
      // Tagged with the origin so the gateway can skip echoing "you are
      // typing" back to the person doing the typing.
      originConnectionId,
    );
  }
}
