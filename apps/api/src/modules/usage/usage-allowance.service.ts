import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsageAllowance, UsageAllowanceSource, UsageProduct } from '../../generated/prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotFoundError, UsageLimitExceededError, UsageLimitExceededDetails } from '../../shared/errors/app-error';
import { RavenErrorCode } from '../../shared/errors/error-codes';
import {
  hoursToMinutes,
  minutesToHours,
  minutesToSeconds,
  secondsToMinutes,
  USAGE_DAILY_DEFAULT_DAYS,
  USAGE_HISTORY_DEFAULT_LIMIT,
} from './usage.constants';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The developer-facing shape of a duration-based allowance (RTC or LIVE_STREAMING). */
export interface UsageSummary {
  /** What this account was granted. Read from its row, never from configuration. */
  includedMinutes: number;
  usedMinutes: number;
  remainingMinutes: number;
  /** 0-100, rounded to one decimal. Capped at 100: a hard stop cannot be 103% spent. */
  usedPercent: number;
  /** True once `usedMinutes >= includedMinutes`. The dashboard's headline state. */
  exhausted: boolean;
  /** When the allowance first ran out, or null. Never cleared once set. */
  exhaustedAt: Date | null;
  /** Whether an exhausted allowance actually refuses new sessions here (`usage.enforceLimit`). */
  enforced: boolean;
  source: UsageAllowanceSource;
  grantedAt: Date;
  /**
   * Seconds, for callers that need the unrounded figure. `usedMinutes` is
   * this floored, so a developer 90 seconds in reads as 1 minute used and
   * not 2.
   */
  usedSeconds: number;
  /** Sessions currently being metered against this allowance. */
  liveSessions: number;
}

/** The developer-facing shape of Chat's count-based allowance. */
export interface ChatUsageSummary {
  includedMessages: number;
  usedMessages: number;
  remainingMessages: number;
  usedPercent: number;
  exhausted: boolean;
  exhaustedAt: Date | null;
  enforced: boolean;
  source: UsageAllowanceSource;
  grantedAt: Date;
}

/** Live Streaming's host-hours allowance, in the display unit (hours, not the underlying minutes). */
export interface LiveStreamingUsageSummary {
  includedHostHours: number;
  usedHostHours: number;
  remainingHostHours: number;
  usedPercent: number;
  exhausted: boolean;
  exhaustedAt: Date | null;
  enforced: boolean;
  source: UsageAllowanceSource;
  grantedAt: Date;
}

/** One row of the usage history list. */
export interface UsageHistoryEntry {
  id: string;
  projectId: string;
  projectName: string | null;
  environment: string;
  roomName: string;
  participantIdentity: string;
  kind: string;
  startedAt: Date;
  endedAt: Date | null;
  /** Seconds counted against the allowance so far. Grows while the session is live. */
  meteredSeconds: number;
  meteredMinutes: number;
  /** Null while live; see UsageCloseReason for the vocabulary. */
  closeReason: string | null;
  live: boolean;
}

/** A day's worth of consumption, for the dashboard chart. */
export interface UsageDailyBucket {
  /** `YYYY-MM-DD`, UTC. */
  date: string;
  seconds: number;
  minutes: number;
  sessions: number;
}

/**
 * Provisions and reads developer allowances.
 *
 * Consumption is not written here — that is `UsageMeterService`, which owns
 * every write to `consumedSeconds`. Keeping reads and grants apart from the
 * metering path means the dashboard's queries can never accidentally move a
 * counter.
 */
@Injectable()
export class UsageAllowanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /** Whether an exhausted allowance refuses new usage of that product on this deployment. */
  get enforced(): boolean {
    return this.configService.get<boolean>('usage.enforceLimit')!;
  }

  /**
   * Creates the allowance a developer spends against for one product.
   * Idempotent, and never regrants: an upsert with an empty update, exactly
   * like `OnboardingService.ensureStarted`.
   *
   * The empty `update` is the important half. Calling this on every read
   * (and it is called on every read) must not reset a spent allowance, and
   * must not resize an existing one just because the product's free-tier
   * default changed since it was granted.
   *
   * Called from three places, deliberately overlapping: registration and
   * first OAuth sign-in, so a fresh account has its RTC row immediately;
   * and every read/meter/send path for the product it concerns, so an
   * account that has never touched Chat or Live Streaming — or predates
   * metering entirely — is provisioned the first time it needs to be
   * rather than reading as "0 of 0".
   */
  async ensureProvisioned(userId: string, product: UsageProduct = UsageProduct.RTC): Promise<UsageAllowance> {
    return this.prisma.usageAllowance.upsert({
      where: { userId_product: { userId, product } },
      create: { userId, product, source: UsageAllowanceSource.FREE_TIER, ...this.defaultGrantFor(product) },
      update: {},
    });
  }

  /** The `includedMinutes`/`includedCount` a *newly provisioned* row of this product gets. */
  private defaultGrantFor(product: UsageProduct): Pick<UsageAllowance, 'includedMinutes' | 'includedCount'> {
    switch (product) {
      case UsageProduct.CHAT:
        return { includedMinutes: null, includedCount: this.configService.get<number>('usage.freeTierChatMessages')! };
      case UsageProduct.LIVE_STREAMING:
        return {
          includedMinutes: hoursToMinutes(this.configService.get<number>('usage.freeTierLiveHostHours')!),
          includedCount: null,
        };
      case UsageProduct.RTC:
      default:
        return { includedMinutes: this.configService.get<number>('usage.freeTierRtcMinutes')!, includedCount: null };
    }
  }

  /**
   * The allowance that funds a project: its owner's.
   *
   * Attribution is by owner, not by the member who happened to join. A
   * project's usage comes out of one account's allowance whoever is in the
   * room/conversation/stream, which is the only reading that makes a shared
   * project's usage predictable — see docs/usage-metering.md#attribution.
   */
  async ensureProvisionedForProject(
    projectId: string,
    product: UsageProduct = UsageProduct.RTC,
  ): Promise<UsageAllowance> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { ownerId: true },
    });
    if (!project) {
      throw new NotFoundError('Project', RavenErrorCode.PROJECT_NOT_FOUND);
    }
    return this.ensureProvisioned(project.ownerId, product);
  }

  /**
   * Whether new usage of this product, for this project, may be admitted.
   *
   * `blocked` is `exhausted AND enforced`, and the two are reported
   * separately on purpose: a self-hosted deployment with enforcement off
   * still wants the dashboard to say the allowance is spent, it just
   * doesn't want the call refused.
   *
   * Usage already in progress (a live RTC/Live-Streaming session) is never
   * consulted against this. Cutting off a live call the moment the last
   * minute ticks over is a worse failure than overshooting the allowance by
   * one session, and a hard stop mid-sentence is not something a developer
   * can debug.
   */
  async checkProject(
    projectId: string,
    product: UsageProduct = UsageProduct.RTC,
  ): Promise<{ allowance: UsageAllowance; exhausted: boolean; blocked: boolean }> {
    const allowance = await this.ensureProvisionedForProject(projectId, product);
    const exhausted = this.isExhausted(allowance);
    return { allowance, exhausted, blocked: exhausted && this.enforced };
  }

  /**
   * The HTTP-path guard: refuses to let a project start new usage of this
   * product once its owner's allowance for it is spent.
   *
   * Throws `UsageLimitExceededError` (403 + `RAVEN_USAGE_LIMIT_EXCEEDED`),
   * carrying the figures so an SDK can render the state from the error
   * alone.
   */
  async assertProjectWithinAllowance(
    projectId: string,
    product: UsageProduct = UsageProduct.RTC,
  ): Promise<UsageAllowance> {
    const { allowance, blocked } = await this.checkProject(projectId, product);
    if (blocked) {
      throw new UsageLimitExceededError(this.toLimitExceededDetails(allowance));
    }
    return allowance;
  }

  private toLimitExceededDetails(allowance: UsageAllowance): UsageLimitExceededDetails {
    if (allowance.product === UsageProduct.CHAT) {
      const included = allowance.includedCount ?? 0;
      const used = allowance.consumedCount;
      return { product: 'CHAT', unit: 'messages', included, used, remaining: Math.max(0, included - used) };
    }

    const includedMinutes = allowance.includedMinutes ?? 0;
    const usedMinutes = secondsToMinutes(allowance.consumedSeconds);
    const remainingMinutes = Math.max(0, includedMinutes - usedMinutes);

    if (allowance.product === UsageProduct.LIVE_STREAMING) {
      const included = minutesToHours(includedMinutes);
      const used = minutesToHours(usedMinutes);
      return {
        product: 'LIVE_STREAMING',
        unit: 'host_hours',
        included,
        used,
        remaining: Math.max(0, included - used),
      };
    }

    // RTC: also carries the legacy includedMinutes/usedMinutes/remainingMinutes
    // keys, unchanged, for backward compatibility with existing parsers.
    return {
      product: 'RTC',
      unit: 'participant_minutes',
      included: includedMinutes,
      used: usedMinutes,
      remaining: remainingMinutes,
      includedMinutes,
      usedMinutes,
      remainingMinutes,
    };
  }

  /** Derives the RTC summary. Provisions first, so a fresh account reads correctly. */
  async getSummary(userId: string): Promise<UsageSummary> {
    const allowance = await this.ensureProvisioned(userId, UsageProduct.RTC);
    const liveSessions = await this.prisma.usageSession.count({
      where: { allowanceId: allowance.id, endedAt: null },
    });
    return this.toSummary(allowance, liveSessions);
  }

  /** Derives the Chat summary. Provisions first, so an account that has never sent a message reads correctly. */
  async getChatSummary(userId: string): Promise<ChatUsageSummary> {
    const allowance = await this.ensureProvisioned(userId, UsageProduct.CHAT);
    return this.toChatSummary(allowance);
  }

  /** Derives the Live Streaming host-hours summary (host time only — viewers are never metered). */
  async getLiveStreamingSummary(userId: string): Promise<LiveStreamingUsageSummary> {
    const allowance = await this.ensureProvisioned(userId, UsageProduct.LIVE_STREAMING);
    return this.toLiveStreamingSummary(allowance);
  }

  /**
   * Whether this allowance has nothing left.
   *
   * Reads the denormalised counter rather than summing sessions/messages:
   * this runs on the hot path (RTC/Live-Streaming join, Chat send), where
   * the query budget is one indexed row lookup.
   */
  isExhausted(allowance: UsageAllowance): boolean {
    if (allowance.product === UsageProduct.CHAT) {
      return allowance.consumedCount >= (allowance.includedCount ?? 0);
    }
    return allowance.consumedSeconds >= minutesToSeconds(allowance.includedMinutes ?? 0);
  }

  /** For RTC and LIVE_STREAMING allowances — both duration-based, sharing includedMinutes/consumedSeconds. */
  toSummary(allowance: UsageAllowance, liveSessions: number): UsageSummary {
    const usedMinutes = secondsToMinutes(allowance.consumedSeconds);
    const includedMinutes = allowance.includedMinutes ?? 0;
    // Clamped at zero: a session that overran its last few seconds must not
    // report negative minutes left.
    const remainingMinutes = Math.max(0, includedMinutes - usedMinutes);
    const usedPercent =
      includedMinutes === 0
        ? 100
        : Math.min(100, Math.round((allowance.consumedSeconds / minutesToSeconds(includedMinutes)) * 1000) / 10);

    return {
      includedMinutes,
      usedMinutes,
      remainingMinutes,
      usedPercent,
      exhausted: this.isExhausted(allowance),
      exhaustedAt: allowance.exhaustedAt,
      enforced: this.enforced,
      source: allowance.source,
      grantedAt: allowance.grantedAt,
      usedSeconds: allowance.consumedSeconds,
      liveSessions,
    };
  }

  private toChatSummary(allowance: UsageAllowance): ChatUsageSummary {
    const includedMessages = allowance.includedCount ?? 0;
    const usedMessages = allowance.consumedCount;
    const remainingMessages = Math.max(0, includedMessages - usedMessages);
    const usedPercent =
      includedMessages === 0 ? 100 : Math.min(100, Math.round((usedMessages / includedMessages) * 1000) / 10);

    return {
      includedMessages,
      usedMessages,
      remainingMessages,
      usedPercent,
      exhausted: this.isExhausted(allowance),
      exhaustedAt: allowance.exhaustedAt,
      enforced: this.enforced,
      source: allowance.source,
      grantedAt: allowance.grantedAt,
    };
  }

  private toLiveStreamingSummary(allowance: UsageAllowance): LiveStreamingUsageSummary {
    const includedHostHours = minutesToHours(allowance.includedMinutes ?? 0);
    const usedHostHours = minutesToHours(secondsToMinutes(allowance.consumedSeconds));
    const remainingHostHours = Math.max(0, includedHostHours - usedHostHours);
    const usedPercent =
      includedHostHours === 0 ? 100 : Math.min(100, Math.round((usedHostHours / includedHostHours) * 1000) / 10);

    return {
      includedHostHours,
      usedHostHours,
      remainingHostHours,
      usedPercent,
      exhausted: this.isExhausted(allowance),
      exhaustedAt: allowance.exhaustedAt,
      enforced: this.enforced,
      source: allowance.source,
      grantedAt: allowance.grantedAt,
    };
  }

  /**
   * Best-effort Chat message counter. Called once per genuinely new message
   * — never for a deduplicated retry — from `MessagesService.send()`, at
   * the same call site as its `messages_sent` metric. A plain atomic
   * increment, not a compare-and-swap: unlike an RTC/Live-Streaming
   * session's duration, a message is a single already-deduplicated event
   * (the DB unique constraint on `(conversationId, senderId,
   * clientMessageId)` guarantees this runs at most once per message), so
   * there is nothing to race against.
   *
   * Throws on failure rather than swallowing it — the caller
   * (`MessagesService.send()`) wraps the call in its own try/catch/log,
   * the same "best-effort at the call site" idiom the RTC meter's sweep
   * and reaper already use, so metering can never fail a send while the
   * failure is still visible in logs.
   */
  async recordChatMessage(projectId: string): Promise<void> {
    const allowance = await this.ensureProvisionedForProject(projectId, UsageProduct.CHAT);
    const { count } = await this.prisma.usageAllowance.updateMany({
      where: { id: allowance.id },
      data: { consumedCount: { increment: 1 } },
    });
    if (count === 0) return;

    const updated = await this.prisma.usageAllowance.findUnique({ where: { id: allowance.id } });
    if (updated && updated.exhaustedAt === null && this.isExhausted(updated)) {
      // Conditional on exhaustedAt: null, same idiom as UsageMeterService's
      // stamp — first crossing wins, never rewritten by a later one.
      await this.prisma.usageAllowance.updateMany({
        where: { id: updated.id, exhaustedAt: null },
        data: { exhaustedAt: new Date() },
      });
    }
  }

  /**
   * This developer's metered RTC sessions, newest first.
   *
   * `projectId` narrows it to one project — the per-project usage page's
   * query. Note that it filters, it does not authorize: the controller has
   * already established what the caller may see.
   *
   * Scoped to `product: RTC`: `UsageSession` now also carries Live
   * Streaming host sessions, and this history/chart/rollup trio stays
   * RTC-only in this phase (Chat and Live Streaming get summary numbers,
   * not a history breakdown yet) — a documented known limitation, not an
   * oversight.
   */
  async listHistory(userId: string, opts: { projectId?: string; limit?: number } = {}): Promise<UsageHistoryEntry[]> {
    const sessions = await this.prisma.usageSession.findMany({
      where: { userId, product: UsageProduct.RTC, ...(opts.projectId ? { projectId: opts.projectId } : {}) },
      orderBy: { startedAt: 'desc' },
      take: opts.limit ?? USAGE_HISTORY_DEFAULT_LIMIT,
      include: { project: { select: { name: true } } },
    });

    return sessions.map((session) => ({
      id: session.id,
      projectId: session.projectId,
      projectName: session.project?.name ?? null,
      environment: session.environment,
      roomName: session.roomName,
      participantIdentity: session.participantIdentity,
      kind: session.kind,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      meteredSeconds: session.meteredSeconds,
      meteredMinutes: secondsToMinutes(session.meteredSeconds),
      closeReason: session.closeReason,
      live: session.endedAt === null,
    }));
  }

  /**
   * Consumption per UTC day, oldest first, with empty days present as
   * zeroes.
   *
   * Bucketed in JS from the session rows rather than with `date_trunc`,
   * because the rows a developer's chart needs are already bounded by the
   * window and by how many sessions one account can run — and a raw query
   * here would be the only untyped query in the module. If this ever stops
   * being cheap, the fix is a rollup table, not a smarter query.
   *
   * A session is attributed wholly to the day it *started*. A call spanning
   * midnight lands on one side of it: exact, and the alternative (splitting
   * seconds across days) buys precision no one reading a bar chart can use.
   */
  async getDailyUsage(userId: string, opts: { projectId?: string; days?: number } = {}): Promise<UsageDailyBucket[]> {
    const days = opts.days ?? USAGE_DAILY_DEFAULT_DAYS;
    const now = new Date();
    // Start of the UTC day, `days - 1` days back: `days` buckets inclusive
    // of today.
    const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const from = new Date(startOfToday - (days - 1) * DAY_MS);

    const sessions = await this.prisma.usageSession.findMany({
      where: {
        userId,
        product: UsageProduct.RTC,
        ...(opts.projectId ? { projectId: opts.projectId } : {}),
        startedAt: { gte: from },
      },
      select: { startedAt: true, meteredSeconds: true },
    });

    const buckets = new Map<string, { seconds: number; sessions: number }>();
    for (let i = 0; i < days; i += 1) {
      buckets.set(toUtcDate(new Date(from.getTime() + i * DAY_MS)), { seconds: 0, sessions: 0 });
    }

    for (const session of sessions) {
      const key = toUtcDate(session.startedAt);
      const bucket = buckets.get(key);
      // A session can only fall outside the pre-seeded range by starting in
      // the future, which a server-set timestamp does not do. Skipped
      // rather than trusted, so a clock skew never invents a bucket.
      if (!bucket) continue;
      bucket.seconds += session.meteredSeconds;
      bucket.sessions += 1;
    }

    return Array.from(buckets.entries()).map(([date, bucket]) => ({
      date,
      seconds: bucket.seconds,
      minutes: secondsToMinutes(bucket.seconds),
      sessions: bucket.sessions,
    }));
  }

  /**
   * Per-project consumption for one developer, largest first.
   *
   * Aggregated with `groupBy` rather than in JS: unlike the daily chart this
   * one has no window bounding it, so it has to stay a single grouped
   * query however long the account's history gets.
   */
  async getUsageByProject(
    userId: string,
  ): Promise<
    Array<{ projectId: string; projectName: string | null; seconds: number; minutes: number; sessions: number }>
  > {
    const grouped = await this.prisma.usageSession.groupBy({
      by: ['projectId'],
      where: { userId, product: UsageProduct.RTC },
      _sum: { meteredSeconds: true },
      _count: { _all: true },
    });

    if (grouped.length === 0) return [];

    const projects = await this.prisma.project.findMany({
      where: { id: { in: grouped.map((row) => row.projectId) } },
      select: { id: true, name: true },
    });
    const names = new Map(projects.map((project) => [project.id, project.name]));

    return grouped
      .map((row) => {
        const seconds = row._sum.meteredSeconds ?? 0;
        return {
          projectId: row.projectId,
          projectName: names.get(row.projectId) ?? null,
          seconds,
          minutes: secondsToMinutes(seconds),
          sessions: row._count._all,
        };
      })
      .sort((a, b) => b.seconds - a.seconds);
  }
}

/** `YYYY-MM-DD` in UTC. Not the ambient timezone: buckets have to be stable across instances. */
function toUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
