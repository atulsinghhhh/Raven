import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type Redis from 'ioredis';
import { RedisService } from '../../../shared/redis/redis.service';
import { RedisKeys } from '../chat.constants';
import { ChatEventEnvelope, ChatRealtimeEvent } from './chat-event.interface';

type EnvelopeHandler = (envelope: ChatEventEnvelope) => void;

/**
 * The distributed fan-out layer (spec §18, §34). Every gateway instance
 * publishes here and subscribes here, so a message sent through Gateway 1
 * reaches a participant parked on Gateway 3 without the two knowing about
 * each other.
 *
 * Subscription is demand-driven: a gateway SUBSCRIBEs to a conversation's
 * channel only while it holds at least one socket in that conversation,
 * and UNSUBSCRIBEs when the last one leaves. A thousand idle conversations
 * cost nothing.
 *
 * Note the dedicated connection — ioredis puts a client into subscriber
 * mode exclusively, so reusing the shared RedisService client here would
 * break every other Redis call in the process.
 */
@Injectable()
export class ChatEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatEventsService.name);
  private subscriber!: Redis;
  private readonly handlers = new Set<EnvelopeHandler>();
  /** channel -> how many local reasons exist to stay subscribed. */
  private readonly refCounts = new Map<string, number>();

  constructor(private readonly redisService: RedisService) {}

  onModuleInit(): void {
    this.subscriber = this.redisService.client.duplicate();

    this.subscriber.on('message', (_channel: string, payload: string) => {
      let envelope: ChatEventEnvelope;
      try {
        envelope = JSON.parse(payload) as ChatEventEnvelope;
      } catch {
        this.logger.warn('discarded malformed event payload from Redis');
        return;
      }
      // A throwing handler must not take down delivery to the others.
      for (const handler of Array.from(this.handlers)) {
        try {
          handler(envelope);
        } catch (err) {
          this.logger.error(`chat event handler failed: ${(err as Error).message}`);
        }
      }
    });

    this.subscriber.on('error', (err: Error) => {
      this.logger.error(`chat event subscriber error: ${err.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.handlers.clear();
    this.refCounts.clear();
    await this.subscriber?.quit().catch(() => undefined);
  }

  onEvent(handler: EnvelopeHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /**
   * Publishes an event to every gateway holding a socket in this
   * conversation. Failures are logged, never thrown: the message is
   * already durably in Postgres at this point, and turning a Redis blip
   * into a failed send would make the caller retry a write that already
   * succeeded (spec §51).
   */
  async publish(
    projectId: string,
    conversationId: string,
    event: ChatRealtimeEvent,
    originConnectionId?: string,
  ): Promise<void> {
    const envelope: ChatEventEnvelope = {
      event,
      projectId,
      originConnectionId,
      publishedAt: Date.now(),
    };

    try {
      await this.redisService.client.publish(
        RedisKeys.conversationChannel(projectId, conversationId),
        JSON.stringify(envelope),
      );
    } catch (err) {
      this.logger.error(
        `real-time fan-out failed for conversation ${conversationId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Ref-counted subscribe. Returns an unsubscribe function; the actual
   * Redis UNSUBSCRIBE only happens when the last local holder releases.
   */
  async subscribe(projectId: string, conversationId: string): Promise<() => Promise<void>> {
    const channel = RedisKeys.conversationChannel(projectId, conversationId);
    const current = this.refCounts.get(channel) ?? 0;
    this.refCounts.set(channel, current + 1);

    if (current === 0) {
      await this.subscriber.subscribe(channel);
    }

    let released = false;
    return async () => {
      // Guard against a double-release dropping someone else's reference.
      if (released) return;
      released = true;

      const next = (this.refCounts.get(channel) ?? 1) - 1;
      if (next <= 0) {
        this.refCounts.delete(channel);
        await this.subscriber.unsubscribe(channel).catch(() => undefined);
      } else {
        this.refCounts.set(channel, next);
      }
    };
  }

  /** For the health/metrics surface — how many conversations this instance is watching. */
  getSubscribedChannelCount(): number {
    return this.refCounts.size;
  }
}
