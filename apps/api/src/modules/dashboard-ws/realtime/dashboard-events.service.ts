import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type Redis from 'ioredis';
import { RedisService } from '../../../shared/redis/redis.service';
import { DashboardWsEvent } from '../dashboard-ws-events';
import { DashboardWsRedisKeys } from '../dashboard-ws.constants';

/** The envelope every dashboard event rides in. */
export interface DashboardEventEnvelope {
  projectId: string;
  event: DashboardWsEvent;
  publishedAt: number;
}

type EnvelopeHandler = (envelope: DashboardEventEnvelope) => void;

/**
 * The distributed fan-out layer for the dashboard realtime transport
 * (Phase 5A's recommended architecture, §4/§8), ported 1:1 from
 * ChatEventsService/RoomEventsService: same dedicated duplicated
 * subscriber connection, same ref-counted per-project subscribe, same
 * fail-open publish. A project-scoped event published from Gateway 1
 * reaches a dashboard tab parked on Gateway 3 without the two knowing
 * about each other.
 *
 * Subscription is demand-driven: an instance SUBSCRIBEs to a project's
 * channel only while it holds at least one local dashboard connection for
 * that project, and UNSUBSCRIBEs when the last one disconnects. A
 * thousand idle projects cost nothing.
 *
 * Phase 5B wired subscribe/unsubscribe into DashboardWsGateway with no
 * publisher. Phase 5C adds the first two: ConnectionsService (on a real
 * ConnectionState transition) and RoomsService (on room creation) —
 * see dashboard-ws-events.ts for the full event vocabulary and why it is
 * NOT the same as WEBHOOK_EVENT_TYPES's same-named events.
 */
@Injectable()
export class DashboardEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DashboardEventsService.name);
  private subscriber!: Redis;
  private readonly handlers = new Set<EnvelopeHandler>();
  /** channel -> how many local reasons exist to stay subscribed. */
  private readonly refCounts = new Map<string, number>();

  constructor(private readonly redisService: RedisService) {}

  onModuleInit(): void {
    // Dedicated connection: ioredis puts a client into subscriber mode
    // exclusively, so reusing the shared RedisService client here would
    // break every other Redis call in the process.
    this.subscriber = this.redisService.client.duplicate();

    this.subscriber.on('message', (_channel: string, payload: string) => {
      let envelope: DashboardEventEnvelope;
      try {
        envelope = JSON.parse(payload) as DashboardEventEnvelope;
      } catch {
        this.logger.warn('discarded malformed dashboard event payload from Redis');
        return;
      }
      // A throwing handler must not take down delivery to the others.
      for (const handler of Array.from(this.handlers)) {
        try {
          handler(envelope);
        } catch (err) {
          this.logger.error(`dashboard event handler failed: ${(err as Error).message}`);
        }
      }
    });

    this.subscriber.on('error', (err: Error) => {
      this.logger.error(`dashboard event subscriber error: ${err.message}`);
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
   * Publishes an event to every gateway instance holding a dashboard
   * connection for this project. Failures are logged, never thrown, same
   * fail-open posture as chat/signaling's publish: whatever durable write
   * produced this event has already committed, and turning a Redis blip
   * into a thrown error would make the caller retry a write that already
   * succeeded.
   */
  async publish(projectId: string, event: DashboardWsEvent): Promise<void> {
    const envelope: DashboardEventEnvelope = { projectId, event, publishedAt: Date.now() };
    try {
      await this.redisService.client.publish(DashboardWsRedisKeys.projectChannel(projectId), JSON.stringify(envelope));
    } catch (err) {
      this.logger.error(`dashboard event fan-out failed for project ${projectId}: ${(err as Error).message}`);
    }
  }

  /**
   * Ref-counted subscribe. Returns an unsubscribe function; the actual
   * Redis UNSUBSCRIBE only happens when the last local holder releases.
   */
  async subscribe(projectId: string): Promise<() => Promise<void>> {
    const channel = DashboardWsRedisKeys.projectChannel(projectId);
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

  /** For the health/metrics surface: how many projects this instance is watching. */
  getSubscribedChannelCount(): number {
    return this.refCounts.size;
  }
}
