import { Injectable } from '@nestjs/common';
import { Prisma, UsageAllowance } from '../../../generated/prisma/client';
import { UsageProduct } from '../../../generated/prisma/enums';
import { PrismaService } from '../../../shared/database/prisma.service';
import { NotFoundError, ValidationFailedError } from '../../../shared/errors/app-error';
import { RavenErrorCode } from '../../../shared/errors/error-codes';
import { AdminAuditService } from '../admin-audit.service';
import { AdminAction, AdminTargetType } from '../admin-audit.constants';
import { AuthenticatedPlatformAdmin } from '../guards/platform-role.guard';
import { AuditContext } from '../../audit/audit-context.decorator';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Trailing window for the per-developer daily chart (spec §14). */
const DAILY_WINDOW_DAYS = 30;
/** Cap on the in-memory `atRisk` scan in `listDevelopers` — see the comment at its call site. */
const MAX_AT_RISK_SCAN = 5000;

/** Alert bands the spec calls out explicitly: 50/75/90/100%. */
export type UsageAlertBand = 'none' | '50' | '75' | '90' | '100';

/** One product's allowance, reduced to the shape every surface in this slice renders. */
export interface ProductUsageBreakdown {
  product: UsageProduct;
  /** False when this developer has never been granted (or used) this product at all — distinct from "used 0 of a real grant". */
  provisioned: boolean;
  unit: 'minutes' | 'messages';
  included: number;
  used: number;
  remaining: number;
  /** 0-100+, uncapped: an admin who lowers a limit below what's already spent should see that, not a number clamped to look fine. */
  usedPercent: number;
  band: UsageAlertBand;
  exhaustedAt: Date | null;
}

export interface OverviewResponse {
  generatedAt: string;
  rtcMinutesThisMonth: number;
  chatMessagesThisMonth: number;
  liveStreamingHostHoursThisMonth: number;
  developersAtRisk: number;
  developersExhausted: number;
}

export interface DeveloperUsageRow {
  userId: string;
  email: string;
  products: ProductUsageBreakdown[];
  /** The highest `usedPercent` across the three products — what a list view sorts/flags on. */
  maxUsedPercent: number;
  maxBand: UsageAlertBand;
  flagged: boolean;
}

export interface DeveloperUsagePage {
  items: DeveloperUsageRow[];
  total: number;
}

export interface DailyUsageBucket {
  /** `YYYY-MM-DD`, UTC. */
  date: string;
  rtcMinutes: number;
  rtcSessions: number;
  liveStreamingMinutes: number;
  liveStreamingSessions: number;
}

export interface DeveloperUsageDetail {
  userId: string;
  email: string;
  createdAt: Date;
  products: ProductUsageBreakdown[];
  /** Chat has no `UsageSession` rows (see implementation-plan.md §4) — only RTC and Live Streaming get a daily trend here. */
  daily: DailyUsageBucket[];
}

export interface UpdateAllowanceInput {
  product: UsageProduct;
  includedMinutes?: number;
  includedCount?: number;
  reason: string;
}

/**
 * Real Prisma queries backing the platform-wide Usage & Limits slice (spec
 * §14) — the cross-developer sibling of `UsageAllowanceService`
 * (apps/api/src/modules/usage), which stays the single owner of consumption
 * *writes* and of the current-user-scoped reads. Nothing here writes a
 * consumption counter; the one mutation this service performs
 * (`updateAllowance`) only ever touches `includedMinutes`/`includedCount`,
 * never `consumedSeconds`/`consumedCount`.
 */
@Injectable()
export class SuperAdminUsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly adminAudit: AdminAuditService,
  ) {}

  async getOverview(): Promise<OverviewResponse> {
    const now = new Date();
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const [rtcAgg, liveAgg, chatMessagesThisMonth, allowances] = await Promise.all([
      // Attributed to the month a session *started*, same convention
      // `UsageAllowanceService.getDailyUsage` uses for days — a session
      // spanning midnight (or month-end) lands wholly on one side of it.
      this.prisma.usageSession.aggregate({
        _sum: { meteredSeconds: true },
        where: { product: UsageProduct.RTC, startedAt: { gte: startOfMonth } },
      }),
      this.prisma.usageSession.aggregate({
        _sum: { meteredSeconds: true },
        where: { product: UsageProduct.LIVE_STREAMING, startedAt: { gte: startOfMonth } },
      }),
      // Chat messages have no `UsageSession` row (see implementation-plan.md
      // §4 — per-message events aren't wired into the hot path yet), so this
      // reads the same real column `OverviewService.getChat` already reads
      // rather than the allowance's all-time `consumedCount` counter, which
      // isn't month-scoped.
      this.prisma.message.count({ where: { createdAt: { gte: startOfMonth }, deletedAt: null } }),
      // Every allowance row on the platform, to classify into alert bands.
      // One query, not one-per-developer: this table is small relative to
      // sessions/messages (one row per developer per product), and grouping
      // "developers at risk" in application code avoids a database-specific
      // conditional-aggregate query for arithmetic this simple.
      this.prisma.usageAllowance.findMany({
        select: {
          userId: true,
          product: true,
          includedMinutes: true,
          includedCount: true,
          consumedSeconds: true,
          consumedCount: true,
        },
      }),
    ]);

    const byUser = new Map<string, number>();
    for (const allowance of allowances) {
      const { usedPercent } = computeBreakdownFigures(allowance);
      byUser.set(allowance.userId, Math.max(byUser.get(allowance.userId) ?? 0, usedPercent));
    }

    let developersAtRisk = 0;
    let developersExhausted = 0;
    for (const maxPercent of byUser.values()) {
      if (maxPercent >= 90) developersAtRisk += 1;
      if (maxPercent >= 100) developersExhausted += 1;
    }

    return {
      generatedAt: now.toISOString(),
      rtcMinutesThisMonth: secondsToMinutes(rtcAgg._sum.meteredSeconds ?? 0),
      chatMessagesThisMonth,
      liveStreamingHostHoursThisMonth: secondsToHours(liveAgg._sum.meteredSeconds ?? 0),
      developersAtRisk,
      developersExhausted,
    };
  }

  async listDevelopers(opts: {
    search?: string;
    atRisk?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<DeveloperUsagePage> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);

    // `atRisk` can't be pushed into the `User` query (it depends on a join
    // across three allowance rows, evaluated in application code below), so
    // when it's set this scans a bounded superset of users — capped at
    // MAX_AT_RISK_SCAN rather than the true unbounded table — and paginates
    // the filtered result in memory. Good enough at the scale this table
    // reaches before an at-risk flag is worth denormalising onto `User`
    // itself; not a real substitute for a filterable column at platform
    // scale, which is the honest limitation to revisit if it's ever hit.
    const where: Prisma.UserWhereInput = opts.search ? { email: { contains: opts.search, mode: 'insensitive' } } : {};

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: { id: true, email: true },
        orderBy: { createdAt: 'desc' },
        take: opts.atRisk ? MAX_AT_RISK_SCAN : limit,
        skip: opts.atRisk ? undefined : offset,
      }),
      opts.atRisk ? undefined : this.prisma.user.count({ where }),
    ]);

    const allowances = await this.prisma.usageAllowance.findMany({
      where: { userId: { in: users.map((u) => u.id) } },
    });
    const byUser = new Map<string, UsageAllowance[]>();
    for (const allowance of allowances) {
      const list = byUser.get(allowance.userId) ?? [];
      list.push(allowance);
      byUser.set(allowance.userId, list);
    }

    let rows = users.map((user) => toDeveloperRow(user, byUser.get(user.id) ?? []));

    if (opts.atRisk) {
      rows = rows.filter((row) => row.flagged);
      const totalAtRisk = rows.length;
      rows = rows.slice(offset, offset + limit);
      return { items: rows, total: totalAtRisk };
    }

    return { items: rows, total: total ?? rows.length };
  }

  async getDeveloper(userId: string): Promise<DeveloperUsageDetail> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, createdAt: true },
    });
    if (!user) {
      throw new NotFoundError('Developer', RavenErrorCode.NOT_FOUND);
    }

    const allowances = await this.prisma.usageAllowance.findMany({ where: { userId } });
    const products = [UsageProduct.RTC, UsageProduct.CHAT, UsageProduct.LIVE_STREAMING].map((product) =>
      toBreakdown(
        product,
        allowances.find((a) => a.product === product),
      ),
    );

    const daily = await this.getDailyUsage(userId);

    return { userId: user.id, email: user.email, createdAt: user.createdAt, products, daily };
  }

  /**
   * Mirrors `UsageAllowanceService.getDailyUsage`'s bucketing shape (attribute
   * a session wholly to the UTC day it started, pre-seed every day in the
   * window as zero), extended to cover both duration-metered products at
   * once — RTC and Live Streaming host time — since the admin detail view
   * wants both trends together, not two separate charts each making its
   * own request.
   */
  private async getDailyUsage(userId: string): Promise<DailyUsageBucket[]> {
    const now = new Date();
    const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const from = new Date(startOfToday - (DAILY_WINDOW_DAYS - 1) * DAY_MS);

    const sessions = await this.prisma.usageSession.findMany({
      where: {
        userId,
        product: { in: [UsageProduct.RTC, UsageProduct.LIVE_STREAMING] },
        startedAt: { gte: from },
      },
      select: { startedAt: true, meteredSeconds: true, product: true },
    });

    const buckets = new Map<string, DailyUsageBucket>();
    for (let i = 0; i < DAILY_WINDOW_DAYS; i += 1) {
      const date = toUtcDate(new Date(from.getTime() + i * DAY_MS));
      buckets.set(date, { date, rtcMinutes: 0, rtcSessions: 0, liveStreamingMinutes: 0, liveStreamingSessions: 0 });
    }

    for (const session of sessions) {
      const bucket = buckets.get(toUtcDate(session.startedAt));
      // Cannot fall outside the pre-seeded range unless a clock is skewed
      // into the future; skipped rather than trusted, same guard
      // `UsageAllowanceService.getDailyUsage` applies.
      if (!bucket) continue;
      const minutes = secondsToMinutes(session.meteredSeconds);
      if (session.product === UsageProduct.RTC) {
        bucket.rtcMinutes += minutes;
        bucket.rtcSessions += 1;
      } else {
        bucket.liveStreamingMinutes += minutes;
        bucket.liveStreamingSessions += 1;
      }
    }

    return Array.from(buckets.values());
  }

  /**
   * The one mutating route in this slice. Only ever touches
   * `includedMinutes`/`includedCount` — never a consumption counter — and
   * always writes an `AdminAuditLog` entry with the before/after grant, per
   * the spec's "admins must not silently modify developer limits" rule.
   *
   * Requires an existing allowance row for this developer+product: an
   * admin edits a grant that already exists (created the moment the
   * developer's own first use of that product provisioned it), rather than
   * this route guessing a free-tier default to seed one from scratch — that
   * default lives in `UsageAllowanceService`/config, and duplicating it
   * here would be a second, driftable source of truth for a number this
   * module doesn't own.
   */
  async updateAllowance(
    userId: string,
    input: UpdateAllowanceInput,
    admin: AuthenticatedPlatformAdmin,
    context?: AuditContext,
  ): Promise<ProductUsageBreakdown> {
    const [user, existing] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } }),
      this.prisma.usageAllowance.findUnique({ where: { userId_product: { userId, product: input.product } } }),
    ]);
    if (!user) {
      throw new NotFoundError('Developer', RavenErrorCode.NOT_FOUND);
    }
    if (!existing) {
      throw new NotFoundError(
        `${input.product} allowance for this developer (they have not used this product yet)`,
        RavenErrorCode.NOT_FOUND,
      );
    }

    const isCountBased = input.product === UsageProduct.CHAT;
    if (isCountBased && input.includedCount === undefined) {
      throw new ValidationFailedError('includedCount is required when product is CHAT');
    }
    if (!isCountBased && input.includedMinutes === undefined) {
      throw new ValidationFailedError('includedMinutes is required when product is RTC or LIVE_STREAMING');
    }

    const before = { includedMinutes: existing.includedMinutes, includedCount: existing.includedCount };
    const data: Prisma.UsageAllowanceUpdateInput = isCountBased
      ? { includedCount: input.includedCount }
      : { includedMinutes: input.includedMinutes };

    // Re-derive `exhaustedAt` against the new grant: a raise that clears
    // exhaustion un-stamps it, a lower that newly exceeds what's already
    // consumed stamps it now. Both are honest reflections of the row's own
    // `isExhausted` rule (`UsageAllowanceService.isExhausted`), not a
    // separate copy of it — recomputed inline here since that method is an
    // instance method on a sibling service this module deliberately
    // doesn't depend on (the two services must not fight over who owns
    // allowance writes).
    const willBeExhausted = isCountBased
      ? existing.consumedCount >= (input.includedCount ?? 0)
      : existing.consumedSeconds >= (input.includedMinutes ?? 0) * 60;
    data.exhaustedAt = willBeExhausted ? (existing.exhaustedAt ?? new Date()) : null;

    const updated = await this.prisma.usageAllowance.update({
      where: { id: existing.id },
      data,
    });

    const after = { includedMinutes: updated.includedMinutes, includedCount: updated.includedCount };

    await this.adminAudit.record({
      admin: { id: admin.id, email: admin.email },
      action: AdminAction.LimitChanged,
      targetType: AdminTargetType.UsageAllowance,
      targetId: updated.id,
      reason: input.reason,
      beforeState: before,
      afterState: after,
      metadata: { developerId: userId, product: input.product },
      context,
    });

    return toBreakdown(input.product, updated);
  }
}

/** Seconds → whole-ish minutes, matching `usage.constants.ts#secondsToMinutes`'s floor-not-round behaviour, duplicated here to keep this module free of a cross-import into `usage.constants`. */
function secondsToMinutes(seconds: number): number {
  return Math.floor(seconds / 60);
}

function secondsToHours(seconds: number): number {
  return Math.round((seconds / 3600) * 100) / 100;
}

function bandFor(usedPercent: number): UsageAlertBand {
  if (usedPercent >= 100) return '100';
  if (usedPercent >= 90) return '90';
  if (usedPercent >= 75) return '75';
  if (usedPercent >= 50) return '50';
  return 'none';
}

/** The raw (included, used, usedPercent) figures for one allowance row, before it's shaped into the response DTO. Shared by the overview aggregate and the per-developer breakdown so the two can never disagree. */
function computeBreakdownFigures(allowance: {
  product: UsageProduct;
  includedMinutes: number | null;
  includedCount: number | null;
  consumedSeconds: number;
  consumedCount: number;
}): { included: number; used: number; usedPercent: number; unit: 'minutes' | 'messages' } {
  if (allowance.product === UsageProduct.CHAT) {
    const included = allowance.includedCount ?? 0;
    const used = allowance.consumedCount;
    const usedPercent = included === 0 ? (used > 0 ? 100 : 0) : Math.round((used / included) * 1000) / 10;
    return { included, used, usedPercent, unit: 'messages' };
  }

  const included = allowance.includedMinutes ?? 0;
  const used = secondsToMinutes(allowance.consumedSeconds);
  const usedPercent = included === 0 ? (used > 0 ? 100 : 0) : Math.round((used / included) * 1000) / 10;
  return { included, used, usedPercent, unit: 'minutes' };
}

function toBreakdown(product: UsageProduct, allowance: UsageAllowance | undefined): ProductUsageBreakdown {
  if (!allowance) {
    return {
      product,
      provisioned: false,
      unit: product === UsageProduct.CHAT ? 'messages' : 'minutes',
      included: 0,
      used: 0,
      remaining: 0,
      usedPercent: 0,
      band: 'none',
      exhaustedAt: null,
    };
  }

  const { included, used, usedPercent, unit } = computeBreakdownFigures(allowance);
  return {
    product,
    provisioned: true,
    unit,
    included,
    used,
    remaining: Math.max(0, included - used),
    usedPercent,
    band: bandFor(usedPercent),
    exhaustedAt: allowance.exhaustedAt,
  };
}

function toDeveloperRow(user: { id: string; email: string }, allowances: UsageAllowance[]): DeveloperUsageRow {
  const products = [UsageProduct.RTC, UsageProduct.CHAT, UsageProduct.LIVE_STREAMING].map((product) =>
    toBreakdown(
      product,
      allowances.find((a) => a.product === product),
    ),
  );
  const maxUsedPercent = Math.max(0, ...products.map((p) => p.usedPercent));
  const maxBand = bandFor(maxUsedPercent);
  return { userId: user.id, email: user.email, products, maxUsedPercent, maxBand, flagged: maxUsedPercent >= 90 };
}

function toUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
