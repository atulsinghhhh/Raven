import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type Redis from 'ioredis';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';
import { isOriginAllowed, type ProjectOriginPolicy } from './origin-policy';

/**
 * One channel for every project's invalidations rather than one per
 * project. Edits are rare (a human in a dashboard), the payload is a
 * project id, and every API instance needs to hear about every project it
 * might be caching — so per-project subscriptions would mean tracking
 * which projects this instance has cached and subscribing/unsubscribing as
 * that set changed, to save traffic that does not exist.
 */
const ORIGIN_INVALIDATION_CHANNEL = 'raven:origins:invalidate';

/** See the note in `onModuleInit` about why this is raised but still finite. */
const SUBSCRIBE_TIMEOUT_MS = 15_000;

/**
 * Reads a project's browser-origin policy, cached.
 *
 * The cache is not an optimisation detail. This runs on every telemetry
 * event — `@ravenkash/rtc` posts one per connection state change plus a
 * stats sample every 5s per participant — and on every chat REST call and
 * WebSocket upgrade. A database round trip on each would put a query on the
 * hot path of a control that answers the same thing all day.
 *
 * ## Staleness, and why it is bounded twice
 *
 * The cache is per-instance and in-memory, and Raven runs several API
 * instances (`infrastructure/k8s` deploys three; Azure Container Apps
 * scales to two). So a dashboard edit lands on whichever instance served
 * the `PATCH`, and clearing only that instance's map would leave every
 * other one answering from a stale copy until its TTL lapsed. For an
 * *added* origin that is merely confusing — the developer saves the
 * setting, and roughly one connection in three works. For a *removed* one
 * it is worse: an origin the developer has just revoked keeps being
 * accepted by the instances that never heard, which is a security decision
 * made on stale data.
 *
 * Hence two bounds rather than one:
 *
 * 1. **Fleet-wide invalidation.** An edit publishes the project id on
 *    `raven:origins:invalidate` and every instance drops its entry, so the
 *    next request on any of them re-reads. This is the mechanism that
 *    makes a removal take effect promptly everywhere.
 *
 * 2. **A short TTL.** Still there, and deliberately not raised now that
 *    invalidation exists, because pub/sub is fire-and-forget: an instance
 *    that was starting up, or briefly partitioned from Redis, misses the
 *    message with no redelivery. The TTL is the backstop that caps how
 *    long such an instance can stay wrong, at 30 seconds, without needing
 *    Redis to have been reliable.
 *
 * Neither is a consistency guarantee, and this deliberately is not a
 * consensus problem. Origin checks are defence in depth layered on top of
 * token authentication — a token holder can drop the `Origin` header
 * entirely — so the honest goal is "promptly correct on every instance",
 * not "atomically correct".
 */
@Injectable()
export class ProjectOriginService implements OnModuleInit, OnModuleDestroy {
  private static readonly TTL_MS = 30_000;

  private readonly logger = new Logger(ProjectOriginService.name);
  private readonly cache = new Map<string, { policy: ProjectOriginPolicy; expiresAt: number }>();
  /** Subscriber-mode connection. Same `duplicate()` reason as `ChatEventsService`. */
  private subscriber?: Redis;
  /** Whether SUBSCRIBE has succeeded, so reconnects don't re-log the same line. */
  private subscribed = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService?: RedisService,
  ) {}

  /**
   * `redisService` is optional so the policy logic stays unit-testable
   * without a Redis double, and so a deployment that somehow starts
   * without it degrades to TTL-only invalidation rather than failing to
   * boot. Nest always injects it in the real application.
   */
  async onModuleInit(): Promise<void> {
    if (!this.redisService) {
      this.logger.warn('no Redis available: origin policy changes will take up to 30s to reach this instance');
      return;
    }

    // A dedicated connection: ioredis puts a client into subscriber mode
    // exclusively, so the shared client cannot be reused here.
    //
    // The timeout is raised, not removed. The shared client's 2s
    // `commandTimeout` is right for the hot path but too tight for a
    // SUBSCRIBE issued while the process is still starting up and
    // competing for I/O — that is what made this fall back to TTL-only
    // during a parallel e2e run. It stays finite so a genuinely
    // partitioned Redis still produces an error the handler below can log,
    // rather than hanging silently.
    //
    // Note `commandTimeout: 0` is *not* "no timeout" in ioredis; it means
    // "time out immediately", and setting it here broke SUBSCRIBE outright.
    this.subscriber = this.redisService.client.duplicate({ commandTimeout: SUBSCRIBE_TIMEOUT_MS });

    this.subscriber.on('message', (_channel: string, projectId: string) => {
      // Local drop only. Re-publishing here would loop the fleet.
      this.cache.delete(projectId);
    });

    this.subscriber.on('error', (err: Error) => {
      this.logger.error(`origin invalidation subscriber error: ${err.message}`);
    });

    // Subscribe on every `ready`, not just once.
    //
    // ioredis emits `ready` on the initial connect *and* after each
    // automatic reconnect, and re-SUBSCRIBE is idempotent in Redis. So this
    // one handler covers three cases that used to be one-shot: the first
    // connect, a reconnect after a blip, and a first attempt that failed
    // outright. Without it, a single failed SUBSCRIBE downgraded the
    // instance to TTL-only propagation permanently — which the e2e run
    // surfaced as "Command timed out" while the tests still passed, exactly
    // the kind of silent degradation this control cannot afford.
    this.subscriber.on('ready', () => {
      void this.subscribeToInvalidations();
    });

    // Still attempt it now: `ready` may already have fired on the
    // eagerly-connecting duplicate before the handler above was attached.
    await this.subscribeToInvalidations();
  }

  private async subscribeToInvalidations(): Promise<void> {
    if (!this.subscriber) {
      return;
    }
    try {
      await this.subscriber.subscribe(ORIGIN_INVALIDATION_CHANNEL);
      if (!this.subscribed) {
        this.subscribed = true;
        this.logger.log('subscribed to fleet-wide origin invalidations');
      }
    } catch (err) {
      // Not fatal: the TTL still bounds staleness, and `ready` will bring
      // us back. Logged at error level because it is degraded security
      // propagation and must be visible as that, never silent.
      this.subscribed = false;
      this.logger.error(
        `could not subscribe to origin invalidations, falling back to the ${ProjectOriginService.TTL_MS}ms TTL: ${(err as Error).message}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.subscriber?.quit().catch(() => undefined);
  }

  /** `null` when no such project exists. See `isAllowed` for why that matters. */
  async getPolicy(projectId: string): Promise<ProjectOriginPolicy | null> {
    const cached = this.cache.get(projectId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.policy;
    }

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { allowedOrigins: true, allowLocalhostOrigins: true },
    });

    if (!project) {
      return null;
    }

    const policy: ProjectOriginPolicy = {
      allowedOrigins: project.allowedOrigins,
      allowLocalhostOrigins: project.allowLocalhostOrigins,
    };
    this.cache.set(projectId, { policy, expiresAt: Date.now() + ProjectOriginService.TTL_MS });
    return policy;
  }

  /** Whether `origin` may act for `projectId`. */
  async isAllowed(projectId: string, origin: string | undefined | null): Promise<boolean> {
    const policy = await this.getPolicy(projectId);

    if (!policy) {
      // The caller's token was validly signed for a project that is not
      // there. That should be impossible, so it is an anomaly rather than a
      // configuration state, and a tenancy control fails closed on an
      // anomaly. Reading it as "unconfigured" would mean open, which is
      // exactly the wrong default here.
      this.logger.warn(`origin policy requested for unknown project ${projectId}; denying`);
      return false;
    }

    return isOriginAllowed(origin, policy);
  }

  /**
   * Called after a project's origins change, so the next request sees
   * them — on this instance and on every other one.
   *
   * The local drop happens first and unconditionally, so the instance that
   * served the edit is correct even if Redis is unreachable. A failed
   * publish is logged, never thrown: the database write has already
   * committed, and turning a Redis blip into a failed `PATCH` would make
   * the developer retry a save that actually succeeded. The TTL still
   * bounds the other instances in that case.
   */
  async invalidate(projectId: string): Promise<void> {
    this.cache.delete(projectId);

    if (!this.redisService) {
      return;
    }

    try {
      await this.redisService.client.publish(ORIGIN_INVALIDATION_CHANNEL, projectId);
    } catch (err) {
      this.logger.error(
        `could not broadcast origin invalidation for project ${projectId}; ` +
          `other instances will refresh within ${ProjectOriginService.TTL_MS}ms: ${(err as Error).message}`,
      );
    }
  }
}
