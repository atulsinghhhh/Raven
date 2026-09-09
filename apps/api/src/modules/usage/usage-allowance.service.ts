import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsageAllowance, UsageAllowanceSource } from '../../generated/prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotFoundError, UsageLimitExceededError } from '../../shared/errors/app-error';
import { RavenErrorCode } from '../../shared/errors/error-codes';
import {
  minutesToSeconds,
  secondsToMinutes,
  USAGE_DAILY_DEFAULT_DAYS,
  USAGE_HISTORY_DEFAULT_LIMIT,
} from './usage.constants';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The developer-facing shape of an allowance. Everything derived, once, here. */
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

  /** Whether an exhausted allowance refuses new RTC sessions on this deployment. */
  get enforced(): boolean {
    return this.configService.get<boolean>('usage.enforceLimit')!;
  }

  /**
   * Creates the allowance a developer spends against. Idempotent, and never
   * regrants: an upsert with an empty update, exactly like
   * `OnboardingService.ensureStarted`.
   *
   * The empty `update` is the important half. Calling this on every read
   * (and it is called on every read) must not reset a spent allowance, and
   * must not resize an existing one just because `usage.freeTierMinutes`
   * changed since it was granted.
   *
   * Called from three places, deliberately overlapping: registration and
   * first OAuth sign-in, so a fresh account has its row immediately; and
   * every read/meter path, so an account that predates metering or came
   * from a seed script is provisioned the first time it needs to be rather
   * than reading as "0 of 0 minutes".
   */
  async ensureProvisioned(userId: string): Promise<UsageAllowance> {
    const includedMinutes = this.configService.get<number>('usage.freeTierMinutes')!;

    return this.prisma.usageAllowance.upsert({
      where: { userId },
      create: { userId, includedMinutes, source: UsageAllowanceSource.FREE_TIER },
      update: {},
    });
  }

  /**
   * The allowance that funds a project: its owner's.
   *
   * Attribution is by owner, not by the member who happened to join. A
   * project's minutes come out of one account's allowance whoever is in the
   * room, which is the only reading that makes a shared project's usage
   * predictable — see docs/usage-metering.md#attribution.
   */
  async ensureProvisionedForProject(projectId: string): Promise<UsageAllowance> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { ownerId: true },
    });
    if (!project) {
      throw new NotFoundError('Project', RavenErrorCode.PROJECT_NOT_FOUND);
    }
    return this.ensureProvisioned(project.ownerId);
  }

  /**
   * Whether a new RTC session for this project may be admitted.
   *
   * `blocked` is `exhausted AND enforced`, and the two are reported
   * separately on purpose: a self-hosted deployment with enforcement off
   * still wants the dashboard to say the allowance is spent, it just
   * doesn't want the call refused.
   *
   * Sessions already in progress are never consulted against this. Cutting
   * off a live call the moment the last minute ticks over is a worse
   * failure than overshooting the allowance by one session, and a hard stop
   * mid-sentence is not something a developer can debug.
   */
  async checkProject(projectId: string): Promise<{ allowance: UsageAllowance; exhausted: boolean; blocked: boolean }> {
    const allowance = await this.ensureProvisionedForProject(projectId);
    const exhausted = this.isExhausted(allowance);
    return { allowance, exhausted, blocked: exhausted && this.enforced };
  }

  /**
   * The HTTP-path guard: refuses to let a project start new RTC work once
   * its owner's allowance is spent.
   *
   * Throws `UsageLimitExceededError` (403 + `RAVEN_USAGE_LIMIT_EXCEEDED`),
   * carrying the figures so an SDK can render the state from the error
   * alone.
   */
  async assertProjectWithinAllowance(projectId: string): Promise<UsageAllowance> {
    const { allowance, blocked } = await this.checkProject(projectId);
    if (blocked) {
      const summary = this.toSummary(allowance, 0);
      throw new UsageLimitExceededError({
        includedMinutes: summary.includedMinutes,
        usedMinutes: summary.usedMinutes,
        remainingMinutes: summary.remainingMinutes,
      });
    }
    return allowance;
  }

  /** Derives the developer-facing summary. Provisions first, so a fresh account reads correctly. */
  async getSummary(userId: string): Promise<UsageSummary> {
    const allowance = await this.ensureProvisioned(userId);
    const liveSessions = await this.prisma.usageSession.count({
      where: { allowanceId: allowance.id, endedAt: null },
    });
    return this.toSummary(allowance, liveSessions);
  }

  /**
   * Whether this allowance has nothing left.
   *
   * Reads the denormalised counter rather than summing sessions: this runs
   * on the join path, where the query budget is one indexed row lookup.
   */
  isExhausted(allowance: UsageAllowance): boolean {
    return allowance.consumedSeconds >= minutesToSeconds(allowance.includedMinutes);
  }

  toSummary(allowance: UsageAllowance, liveSessions: number): UsageSummary {
    const usedMinutes = secondsToMinutes(allowance.consumedSeconds);
    const includedMinutes = allowance.includedMinutes;
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

  /**
   * This developer's metered sessions, newest first.
   *
   * `projectId` narrows it to one project — the per-project usage page's
   * query. Note that it filters, it does not authorize: the controller has
   * already established what the caller may see.
   */
  async listHistory(userId: string, opts: { projectId?: string; limit?: number } = {}): Promise<UsageHistoryEntry[]> {
    const sessions = await this.prisma.usageSession.findMany({
      where: { userId, ...(opts.projectId ? { projectId: opts.projectId } : {}) },
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
      where: { userId },
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
