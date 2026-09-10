import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type Redis from 'ioredis';
import { RedisService } from '../../../shared/redis/redis.service';
import { SignalingRedisKeys } from '../signaling.constants';
import { SignalingEventEnvelope } from './signaling-event.interface';

type EnvelopeHandler = (roomId: string, envelope: SignalingEventEnvelope) => void;

/**
 * The distributed fan-out layer for signaling, ported 1:1 from
 * `chat/realtime/chat-events.service.ts`: same dedicated duplicated
 * subscriber, same ref-counted per-room subscribe, same fail-open publish.
 * A join/leave/relay on Gateway 1 reaches a participant parked on
 * Gateway 3 without the two knowing about each other.
 *
 * Subscription is demand-driven: a gateway SUBSCRIBEs to a room's channel
 * only while it holds at least one local participant in that room, and
 * UNSUBSCRIBEs when the last one leaves.
 *
 * Note the dedicated connection: ioredis puts a client into subscriber
 * mode exclusively, so reusing the shared RedisService client here would
 * break every other Redis call in the process.
 */
@Injectable()
export class RoomEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RoomEventsService.name);
  private subscriber!: Redis;
  private readonly handlers = new Set<EnvelopeHandler>();
  /** channel -> how many local reasons exist to stay subscribed. */
  private readonly refCounts = new Map<string, number>();

  constructor(private readonly redisService: RedisService) {}

  onModuleInit(): void {
    this.subscriber = this.redisService.client.duplicate();

    this.subscriber.on('message', (channel: string, payload: string) => {
      const roomId = this.roomIdFromChannel(channel);
      if (!roomId) return;

      let envelope: SignalingEventEnvelope;
      try {
        envelope = JSON.parse(payload) as SignalingEventEnvelope;
      } catch {
        this.logger.warn('discarded malformed signaling event payload from Redis');
        return;
      }
      // A throwing handler must not take down delivery to the others.
      for (const handler of Array.from(this.handlers)) {
        try {
          handler(roomId, envelope);
        } catch (err) {
          this.logger.error(`signaling event handler failed: ${(err as Error).message}`);
        }
      }
    });

    this.subscriber.on('error', (err: Error) => {
      this.logger.error(`signaling event subscriber error: ${err.message}`);
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
   * Publishes an event to every gateway holding a local participant in
   * this room. Failures are logged, never thrown: a Redis blip should
   * degrade a relay/broadcast, not turn it into an error the caller has
   * to handle mid-signaling-flow (same fail-open posture as chat's
   * publish).
   */
  async publish(roomId: string, envelope: SignalingEventEnvelope): Promise<void> {
    try {
      await this.redisService.client.publish(SignalingRedisKeys.roomChannel(roomId), JSON.stringify(envelope));
    } catch (err) {
      this.logger.error(`signaling fan-out failed for room ${roomId}: ${(err as Error).message}`);
    }
  }

  /**
   * Ref-counted subscribe. Returns an unsubscribe function; the actual
   * Redis UNSUBSCRIBE only happens when the last local holder releases.
   */
  async subscribe(roomId: string): Promise<() => Promise<void>> {
    const channel = SignalingRedisKeys.roomChannel(roomId);
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

  /** For the health/metrics surface: how many rooms this instance is watching. */
  getSubscribedChannelCount(): number {
    return this.refCounts.size;
  }

  private roomIdFromChannel(channel: string): string | null {
    const prefix = 'raven:signaling:room:';
    const suffix = ':events';
    if (!channel.startsWith(prefix) || !channel.endsWith(suffix)) return null;
    return channel.slice(prefix.length, channel.length - suffix.length);
  }
}
