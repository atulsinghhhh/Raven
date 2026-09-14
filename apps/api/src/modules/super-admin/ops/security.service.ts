import { Injectable } from '@nestjs/common';
import { AccountStatus, ActivityEventType } from '../../../generated/prisma/enums';
import { PrismaService } from '../../../shared/database/prisma.service';
import { daysAgo, hoursAgo, startOfDayUtc, startOfWeekUtc } from './date-window.util';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface RiskIndicator {
  developerId: string;
  email: string | null;
  riskLevel: RiskLevel;
  /** Plain-language reasons the level was assigned — makes the deterministic rule legible without reading this file. */
  reasons: string[];
  loginFailedCount24h: number;
  suspiciousOrRateLimitCount7d: number;
  suspendedInLast24h: boolean;
}

export interface SecurityOverviewResponse {
  generatedAt: string;
  failedLogins: { today: number; thisWeek: number };
  suspiciousActivity: { today: number; thisWeek: number };
  rateLimitViolations: { today: number; thisWeek: number };
  accountLockouts: { today: number; thisWeek: number; currentlySuspended: number };
  revokedApiKeys: { today: number; thisWeek: number };
  adminSecurityEvents: { today: number; thisWeek: number };
  riskIndicators: RiskIndicator[];
}

const RISK_WINDOW_HOURS = 24;
const HIGH_LOGIN_FAILED_THRESHOLD = 5;
const MEDIUM_LOOKBACK_DAYS = 7;
/** Caps the risk-indicator fan-out below — see the class comment. */
const MAX_RISK_INDICATORS = 200;

/**
 * Security surface (spec §16): real counts off `ActivityEvent`, plus a
 * deterministic, explainable risk-level per developer.
 *
 * Per the spec ("Do not build an overcomplicated AI security system
 * initially. Use deterministic rules first."), this is NOT a model and
 * has no learned weights. The rules, in priority order, are:
 *
 *   CRITICAL — an ACCOUNT_SUSPENDED event for this developer in the
 *              trailing 24h (they are suspended right now, or were very
 *              recently — the most severe, unambiguous signal available).
 *   HIGH     — 5 or more LOGIN_FAILED events for this developer in the
 *              trailing 24h (a plausible brute-force/credential-stuffing
 *              pattern; 5 is a starting threshold, not a tuned one).
 *   MEDIUM   — any SUSPICIOUS_ACTIVITY or RATE_LIMIT_TRIGGERED event for
 *              this developer in the trailing 7 days.
 *   LOW      — has at least one relevant security event in the trailing
 *              24h (so they appear on this list at all) but matches none
 *              of the above.
 *
 * The population itself is every developer with >=1 of
 * {LOGIN_FAILED, SUSPICIOUS_ACTIVITY, RATE_LIMIT_TRIGGERED,
 * ACCOUNT_SUSPENDED, API_KEY_REVOKED} in the trailing 24h — a developer
 * with zero recent security-relevant events never appears, rather than
 * showing as a manufactured "LOW" row for everyone in the system.
 */
@Injectable()
export class SecurityService {
  private readonly relevantTypes: ActivityEventType[] = [
    ActivityEventType.LOGIN_FAILED,
    ActivityEventType.SUSPICIOUS_ACTIVITY,
    ActivityEventType.RATE_LIMIT_TRIGGERED,
    ActivityEventType.ACCOUNT_SUSPENDED,
    ActivityEventType.API_KEY_REVOKED,
  ];

  constructor(private readonly prisma: PrismaService) {}

  async getOverview(): Promise<SecurityOverviewResponse> {
    const now = new Date();
    const startOfDay = startOfDayUtc(now);
    const startOfWeek = startOfWeekUtc(now);

    const [
      failedLoginsToday,
      failedLoginsThisWeek,
      suspiciousToday,
      suspiciousThisWeek,
      rateLimitToday,
      rateLimitThisWeek,
      lockoutsToday,
      lockoutsThisWeek,
      currentlySuspended,
      revokedKeysToday,
      revokedKeysThisWeek,
      adminSecurityToday,
      adminSecurityThisWeek,
      riskIndicators,
    ] = await Promise.all([
      this.countEvents(ActivityEventType.LOGIN_FAILED, startOfDay),
      this.countEvents(ActivityEventType.LOGIN_FAILED, startOfWeek),
      this.countEvents(ActivityEventType.SUSPICIOUS_ACTIVITY, startOfDay),
      this.countEvents(ActivityEventType.SUSPICIOUS_ACTIVITY, startOfWeek),
      this.countEvents(ActivityEventType.RATE_LIMIT_TRIGGERED, startOfDay),
      this.countEvents(ActivityEventType.RATE_LIMIT_TRIGGERED, startOfWeek),
      this.countEvents(ActivityEventType.ACCOUNT_SUSPENDED, startOfDay),
      this.countEvents(ActivityEventType.ACCOUNT_SUSPENDED, startOfWeek),
      this.prisma.user.count({ where: { status: AccountStatus.SUSPENDED } }),
      this.countEvents(ActivityEventType.API_KEY_REVOKED, startOfDay),
      this.countEvents(ActivityEventType.API_KEY_REVOKED, startOfWeek),
      this.countEvents(
        [ActivityEventType.ADMIN_ACCOUNT_SUSPENDED, ActivityEventType.ADMIN_ACCOUNT_UNSUSPENDED],
        startOfDay,
      ),
      this.countEvents(
        [ActivityEventType.ADMIN_ACCOUNT_SUSPENDED, ActivityEventType.ADMIN_ACCOUNT_UNSUSPENDED],
        startOfWeek,
      ),
      this.computeRiskIndicators(now),
    ]);

    return {
      generatedAt: now.toISOString(),
      failedLogins: { today: failedLoginsToday, thisWeek: failedLoginsThisWeek },
      suspiciousActivity: { today: suspiciousToday, thisWeek: suspiciousThisWeek },
      rateLimitViolations: { today: rateLimitToday, thisWeek: rateLimitThisWeek },
      accountLockouts: { today: lockoutsToday, thisWeek: lockoutsThisWeek, currentlySuspended },
      revokedApiKeys: { today: revokedKeysToday, thisWeek: revokedKeysThisWeek },
      adminSecurityEvents: { today: adminSecurityToday, thisWeek: adminSecurityThisWeek },
      riskIndicators,
    };
  }

  private async countEvents(eventType: ActivityEventType | ActivityEventType[], since: Date): Promise<number> {
    return this.prisma.activityEvent.count({
      where: {
        eventType: Array.isArray(eventType) ? { in: eventType } : eventType,
        createdAt: { gte: since },
      },
    });
  }

  private async computeRiskIndicators(now: Date): Promise<RiskIndicator[]> {
    const window24h = hoursAgo(now, RISK_WINDOW_HOURS);
    const window7d = daysAgo(now, MEDIUM_LOOKBACK_DAYS);

    const distinct = await this.prisma.activityEvent.findMany({
      where: {
        eventType: { in: this.relevantTypes },
        developerId: { not: null },
        createdAt: { gte: window24h },
      },
      select: { developerId: true },
      distinct: ['developerId'],
      take: MAX_RISK_INDICATORS,
    });

    const developerIds = distinct.map((d) => d.developerId).filter((id): id is string => Boolean(id));

    return Promise.all(
      developerIds.map(async (developerId): Promise<RiskIndicator> => {
        const [suspendedCount24h, loginFailedCount24h, suspiciousOrRateLimitCount7d, user] = await Promise.all([
          this.prisma.activityEvent.count({
            where: { developerId, eventType: ActivityEventType.ACCOUNT_SUSPENDED, createdAt: { gte: window24h } },
          }),
          this.prisma.activityEvent.count({
            where: { developerId, eventType: ActivityEventType.LOGIN_FAILED, createdAt: { gte: window24h } },
          }),
          this.prisma.activityEvent.count({
            where: {
              developerId,
              eventType: { in: [ActivityEventType.SUSPICIOUS_ACTIVITY, ActivityEventType.RATE_LIMIT_TRIGGERED] },
              createdAt: { gte: window7d },
            },
          }),
          this.prisma.user.findUnique({ where: { id: developerId }, select: { email: true } }),
        ]);

        const suspendedInLast24h = suspendedCount24h > 0;
        const reasons: string[] = [];
        let riskLevel: RiskLevel;

        if (suspendedInLast24h) {
          riskLevel = 'CRITICAL';
          reasons.push('Account suspended in the last 24 hours');
        } else if (loginFailedCount24h >= HIGH_LOGIN_FAILED_THRESHOLD) {
          riskLevel = 'HIGH';
          reasons.push(`${loginFailedCount24h} failed logins in the last 24 hours`);
        } else if (suspiciousOrRateLimitCount7d > 0) {
          riskLevel = 'MEDIUM';
          reasons.push(`${suspiciousOrRateLimitCount7d} suspicious-activity/rate-limit event(s) in the last 7 days`);
        } else {
          riskLevel = 'LOW';
          reasons.push('Recent security-relevant event, below the medium/high thresholds');
        }

        return {
          developerId,
          email: user?.email ?? null,
          riskLevel,
          reasons,
          loginFailedCount24h,
          suspiciousOrRateLimitCount7d,
          suspendedInLast24h,
        };
      }),
    );
  }
}
