import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  WebhookDeliveryStatus,
  WebhookEndpointStatus,
} from '../../generated/prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { RedisService } from '../../shared/redis/redis.service';
import { Environment } from '../../shared/environment/environment.constants';
import { RedisKeys } from '../chat/chat.constants';
import {
  WEBHOOK_EVENT_ID_HEADER,
  WEBHOOK_EVENT_TYPE_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  signWebhookPayload,
} from './webhook-signature.util';

const LOCK_TTL_SECONDS = 30;
const MAX_ERROR_LENGTH = 500;

/** One queued delivery joined to the event it carries and the endpoint it targets. */
interface DueDelivery {
  id: string;
  attempts: number;
  event: {
    publicId: string;
    type: string;
    payload: unknown;
    createdAt: Date;
    projectId: string;
    environment: Environment;
  };
  endpoint: { id: string; url: string; signingSecret: string; consecutiveFailures: number };
}

/**
 * Drains the delivery queue out-of-band (spec §32). Polls Postgres on an
 * interval, not pulling in a job-queue dependency: same reasoning
 * as observability's RetentionService, and it keeps the deployment to
 * Postgres + Redis (spec §60).
 *
 * A Redis lock means only one API instance delivers at a time, so a
 * horizontally-scaled deployment doesn't send every webhook N times.
 * The lock has a TTL, so an instance dying mid-batch doesn't wedge the
 * queue: the worst case is one batch being retried, which is exactly why
 * every event carries an idempotent `evt_...` id for receivers to dedupe on.
 */
@Injectable()
export class WebhookDeliveryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookDeliveryWorker.name);
  private timer?: NodeJS.Timeout;
  private draining = false;
  private readonly instanceId = `wh_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    const intervalMs = this.configService.get<number>('webhooks.pollIntervalMs')!;
    this.timer = setInterval(() => void this.tick(), intervalMs);
    // unref so a lingering interval can't hold the process open during
    // tests or a graceful shutdown.
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  /** Exposed so tests can drive one pass deterministically instead of waiting on the interval. */
  async tick(): Promise<number> {
    if (this.draining) {
      return 0;
    }
    this.draining = true;
    let holdsLock = false;
    try {
      holdsLock = await this.acquireLock();
      if (!holdsLock) {
        return 0;
      }
      return await this.drainBatch();
    } catch (err) {
      this.logger.error(`webhook worker pass failed: ${(err as Error).message}`);
      return 0;
    } finally {
      // Released at the end of every pass, not left to expire. The TTL is
      // only a crash guard: holding the lock for its full lifetime would
      // stall the queue for 30s after each empty poll.
      if (holdsLock) {
        await this.releaseLock();
      }
      this.draining = false;
    }
  }

  private async acquireLock(): Promise<boolean> {
    try {
      const acquired = await this.redisService.client.set(
        RedisKeys.webhookWorkerLock,
        this.instanceId,
        'EX',
        LOCK_TTL_SECONDS,
        'NX',
      );
      return acquired === 'OK';
    } catch (err) {
      // No Redis means no coordination. Skip rather than risk every
      // instance delivering the same events simultaneously.
      this.logger.warn(`could not acquire webhook lock: ${(err as Error).message}`);
      return false;
    }
  }

  /**
   * Deletes the lock only if this instance still owns it. Checking the
   * value first matters: if a pass overran the TTL and another instance
   * has since taken the lock, a blind DEL would yank it out from under
   * them mid-delivery.
   */
  private async releaseLock(): Promise<void> {
    try {
      const current = await this.redisService.client.get(RedisKeys.webhookWorkerLock);
      if (current === this.instanceId) {
        await this.redisService.client.del(RedisKeys.webhookWorkerLock);
      }
    } catch (err) {
      // Falling back to TTL expiry is correct, just slower.
      this.logger.warn(`could not release webhook lock: ${(err as Error).message}`);
    }
  }

  private async drainBatch(): Promise<number> {
    const batchSize = this.configService.get<number>('webhooks.batchSize')!;

    const due = await this.prisma.webhookDelivery.findMany({
      where: {
        status: WebhookDeliveryStatus.PENDING,
        nextAttemptAt: { lte: new Date() },
        endpoint: { status: WebhookEndpointStatus.ACTIVE },
      },
      include: { event: true, endpoint: true },
      orderBy: { nextAttemptAt: 'asc' },
      take: batchSize,
    });

    for (const delivery of due) {
      await this.attempt(delivery);
    }
    return due.length;
  }

  private async attempt(delivery: DueDelivery): Promise<void> {
    const maxAttempts = this.configService.get<number>('webhooks.maxAttempts')!;
    const timeoutMs = this.configService.get<number>('webhooks.timeoutMs')!;

    // The exact bytes that get signed. Serialize once: re-stringifying
    // for the signature and again for the body risks key-order drift and
    // a signature the receiver can't verify.
    const body = JSON.stringify({
      id: delivery.event.publicId,
      type: delivery.event.type,
      projectId: delivery.event.projectId,
      // In the envelope so a receiver handling several environments can
      // route on it without keeping a map of which endpoint is which.
      environment: delivery.event.environment,
      createdAt: delivery.event.createdAt.toISOString(),
      data: delivery.event.payload,
    });

    const timestamp = Math.floor(Date.now() / 1000);
    const attempts = delivery.attempts + 1;

    let responseStatus: number | undefined;
    let failure: string | undefined;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(delivery.endpoint.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'user-agent': 'Raven-Webhooks/1.0',
            [WEBHOOK_SIGNATURE_HEADER]: signWebhookPayload(body, delivery.endpoint.signingSecret, timestamp),
            [WEBHOOK_EVENT_ID_HEADER]: delivery.event.publicId,
            [WEBHOOK_EVENT_TYPE_HEADER]: delivery.event.type,
          },
          body,
          signal: controller.signal,
        });
        responseStatus = response.status;
        if (!response.ok) {
          failure = `endpoint responded ${response.status}`;
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
    }

    if (!failure) {
      await this.prisma.$transaction([
        this.prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: {
            status: WebhookDeliveryStatus.DELIVERED,
            attempts,
            responseStatus,
            deliveredAt: new Date(),
            lastError: null,
          },
        }),
        this.prisma.webhookEndpoint.update({
          where: { id: delivery.endpoint.id },
          data: { consecutiveFailures: 0, lastDeliveryAt: new Date() },
        }),
      ]);
      return;
    }

    const exhausted = attempts >= maxAttempts;
    await this.prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: exhausted ? WebhookDeliveryStatus.FAILED : WebhookDeliveryStatus.PENDING,
        attempts,
        responseStatus,
        // Truncated, and never the response body: a failing endpoint can
        // return anything, including data we shouldn't be storing.
        lastError: failure.slice(0, MAX_ERROR_LENGTH),
        nextAttemptAt: exhausted ? undefined : new Date(Date.now() + this.backoffMs(attempts)),
      },
    });

    const consecutiveFailures = delivery.endpoint.consecutiveFailures + 1;
    const disableAfter = this.configService.get<number>('webhooks.disableAfterConsecutiveFailures')!;
    await this.prisma.webhookEndpoint.update({
      where: { id: delivery.endpoint.id },
      data: {
        consecutiveFailures,
        lastDeliveryAt: new Date(),
        // A permanently dead URL stops burning retry budget forever. The
        // developer re-enables it from the dashboard once it's fixed.
        ...(consecutiveFailures >= disableAfter ? { status: WebhookEndpointStatus.DISABLED } : {}),
      },
    });

    this.logger.warn(
      `webhook delivery ${delivery.id} attempt ${attempts}/${maxAttempts} failed: ${failure.slice(0, 120)}`,
    );
  }

  /** Exponential: base × 2^(attempt-1). 10s, 20s, 40s, 80s, 160s, 320s by default. */
  private backoffMs(attempt: number): number {
    const base = this.configService.get<number>('webhooks.backoffBaseMs')!;
    return base * Math.pow(2, attempt - 1);
  }
}
