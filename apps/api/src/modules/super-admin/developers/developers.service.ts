import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AccountStatus,
  ActivityEvent,
  ActivityEventType,
  Prisma,
  Project,
  ProjectMember,
} from '../../../generated/prisma/client';
import { PrismaService } from '../../../shared/database/prisma.service';
import { ActivityEventsService } from '../activity-events.service';
import { DeveloperSortField, QueryDevelopersDto } from './dto/query-developers.dto';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** Security-relevant event types (spec §6's Security tab) — includes the `ADMIN_*` mirrors
 * `AdminAuditService` writes when a suspend/unsuspend happens through this very module, so an
 * account's own suspension shows up in its own Security tab, not only in the platform-wide audit log. */
const SECURITY_EVENT_TYPES: ActivityEventType[] = [
  ActivityEventType.USER_LOGIN,
  ActivityEventType.LOGIN_FAILED,
  ActivityEventType.PASSWORD_CHANGED,
  ActivityEventType.OAUTH_CONNECTED,
  ActivityEventType.ACCOUNT_SUSPENDED,
  ActivityEventType.ACCOUNT_UNSUSPENDED,
  ActivityEventType.API_KEY_CREATED,
  ActivityEventType.API_KEY_REVOKED,
  ActivityEventType.SUSPICIOUS_ACTIVITY,
  ActivityEventType.RATE_LIMIT_TRIGGERED,
  ActivityEventType.ADMIN_ACCOUNT_SUSPENDED,
  ActivityEventType.ADMIN_ACCOUNT_UNSUSPENDED,
];

const OVERVIEW_RECENT_LIMIT = 5;
const ACTIVITY_TAB_LIMIT = 100;
const SECURITY_TAB_LIMIT = 100;
const PROJECTS_LIST_CAP = 200;

const DEVELOPER_SELECT = {
  id: true,
  email: true,
  name: true,
  status: true,
  createdAt: true,
  suspendedAt: true,
  suspendedReason: true,
  platformRole: true,
  passwordHash: true,
  authAccounts: { select: { provider: true, email: true, createdAt: true } },
} satisfies Prisma.UserSelect;

type DeveloperRow = Prisma.UserGetPayload<{ select: typeof DEVELOPER_SELECT }>;

export interface DeveloperListItem {
  id: string;
  email: string;
  name: string | null;
  status: AccountStatus;
  createdAt: string;
  lastActiveAt: string | null;
  projectsCount: number;
  rtcMinutesThisMonth: number;
  chatMessagesThisMonth: number;
  liveMinutesThisMonth: number;
  apiEventsThisMonth: number;
  riskLevel: RiskLevel;
  authProviders: string[];
}

export interface DeveloperListPage {
  items: DeveloperListItem[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Real Prisma queries only — no invented numbers (implementation-plan.md §2).
 * A handful of the metrics below are deliberate, documented proxies rather
 * than a literal reading of the spec's column name, because no table
 * captures the literal thing without inventing one:
 *
 * - "RTC usage" / "Live usage" = `UsageSession.meteredSeconds` summed for
 *   `product = RTC` / `LIVE_STREAMING`, `userId = developerId`. `UsageSession`
 *   is keyed by the *allowance owner* (the developer), not the end-user
 *   participant — it already is "this developer's platform usage," which is
 *   exactly the column's intent.
 * - "Chat usage" has no allowance/session table at all (`UsageKind` only
 *   covers RTC/live minutes) — it's `chat_messages` rows scoped to projects
 *   the developer owns, in the window.
 * - "API requests" has no per-request log — deliberately so, per §4, to
 *   avoid a hot-path write per call. The nearest real number is a count of
 *   this developer's `ActivityEvent` rows in the window, which is exactly
 *   what *is* recorded on every API-driven action. It undercounts raw
 *   request volume and is documented as such everywhere it's surfaced.
 * - "This month" = calendar month to date (UTC), for every "usage this
 *   month" figure — an arbitrary but stated window, matching the plan's
 *   "your call — document it."
 */
@Injectable()
export class DevelopersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityEvents: ActivityEventsService,
  ) {}

  async list(query: QueryDevelopersDto): Promise<DeveloperListPage> {
    const limit = Math.min(Math.max(query.limit ?? 25, 1), 100);
    const offset = Math.max(query.offset ?? 0, 0);

    const where: Prisma.UserWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { email: { contains: query.search, mode: 'insensitive' } },
              { name: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };

    const sortBy: DeveloperSortField = query.sortBy ?? 'createdAt';
    const sortDir = query.sortDir ?? 'desc';

    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        select: DEVELOPER_SELECT,
        orderBy: { [sortBy]: sortDir },
        take: limit,
        skip: offset,
      }),
    ]);

    const items = users.length === 0 ? [] : await this.attachListMetrics(users);

    return { items, total, limit, offset };
  }

  /** One bulk pass of aggregate queries for a page of developers, rather than N+1 per row. */
  private async attachListMetrics(users: DeveloperRow[]): Promise<DeveloperListItem[]> {
    const ids = users.map((u) => u.id);
    const monthStart = startOfCurrentMonthUtc();
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [
      projectCounts,
      rtcSums,
      liveSums,
      ownedProjects,
      lastActive,
      loginFailedCounts,
      suspiciousCounts,
      apiEventCounts,
    ] = await Promise.all([
      this.prisma.projectMember.groupBy({ by: ['userId'], where: { userId: { in: ids } }, _count: { _all: true } }),
      this.prisma.usageSession.groupBy({
        by: ['userId'],
        where: { userId: { in: ids }, product: 'RTC', startedAt: { gte: monthStart } },
        _sum: { meteredSeconds: true },
      }),
      this.prisma.usageSession.groupBy({
        by: ['userId'],
        where: { userId: { in: ids }, product: 'LIVE_STREAMING', startedAt: { gte: monthStart } },
        _sum: { meteredSeconds: true },
      }),
      this.prisma.project.findMany({ where: { ownerId: { in: ids } }, select: { id: true, ownerId: true } }),
      this.prisma.activityEvent.groupBy({
        by: ['developerId'],
        where: { developerId: { in: ids } },
        _max: { createdAt: true },
      }),
      this.prisma.activityEvent.groupBy({
        by: ['developerId'],
        where: { developerId: { in: ids }, eventType: ActivityEventType.LOGIN_FAILED, createdAt: { gte: dayAgo } },
        _count: { _all: true },
      }),
      this.prisma.activityEvent.groupBy({
        by: ['developerId'],
        where: {
          developerId: { in: ids },
          eventType: { in: [ActivityEventType.SUSPICIOUS_ACTIVITY, ActivityEventType.RATE_LIMIT_TRIGGERED] },
          createdAt: { gte: weekAgo },
        },
        _count: { _all: true },
      }),
      this.prisma.activityEvent.groupBy({
        by: ['developerId'],
        where: { developerId: { in: ids }, createdAt: { gte: monthStart } },
        _count: { _all: true },
      }),
    ]);

    const ownedProjectIds = ownedProjects.map((p) => p.id);
    const ownerByProjectId = new Map(ownedProjects.map((p) => [p.id, p.ownerId]));

    const chatCountsByProject =
      ownedProjectIds.length === 0
        ? []
        : await this.prisma.message.groupBy({
            by: ['projectId'],
            where: { projectId: { in: ownedProjectIds }, createdAt: { gte: monthStart } },
            _count: { _all: true },
          });

    const chatCountsByOwner = new Map<string, number>();
    for (const row of chatCountsByProject) {
      const ownerId = ownerByProjectId.get(row.projectId);
      if (!ownerId) continue;
      chatCountsByOwner.set(ownerId, (chatCountsByOwner.get(ownerId) ?? 0) + row._count._all);
    }

    const projectCountByUser = new Map(projectCounts.map((r) => [r.userId, r._count._all]));
    const loginFailedByUser = new Map(
      loginFailedCounts
        .filter((r): r is typeof r & { developerId: string } => r.developerId !== null)
        .map((r) => [r.developerId, r._count._all]),
    );
    const suspiciousByUser = new Map(
      suspiciousCounts
        .filter((r): r is typeof r & { developerId: string } => r.developerId !== null)
        .map((r) => [r.developerId, r._count._all]),
    );
    const apiEventsByUser = new Map(
      apiEventCounts
        .filter((r): r is typeof r & { developerId: string } => r.developerId !== null)
        .map((r) => [r.developerId, r._count._all]),
    );
    const rtcSumByUser = new Map(rtcSums.map((r) => [r.userId, r._sum.meteredSeconds ?? 0]));
    const liveSumByUser = new Map(liveSums.map((r) => [r.userId, r._sum.meteredSeconds ?? 0]));
    const lastActiveByUser = new Map(
      lastActive
        .filter((r): r is typeof r & { developerId: string } => r.developerId !== null)
        .map((r) => [r.developerId, r._max.createdAt]),
    );

    return users.map((user) => {
      const riskLevel = deriveRiskLevel({
        suspended: user.status === 'SUSPENDED',
        loginFailedLast24h: loginFailedByUser.get(user.id) ?? 0,
        suspiciousLast7d: suspiciousByUser.get(user.id) ?? 0,
      });

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        status: user.status,
        createdAt: user.createdAt.toISOString(),
        lastActiveAt: (lastActiveByUser.get(user.id) ?? null)?.toISOString() ?? null,
        projectsCount: projectCountByUser.get(user.id) ?? 0,
        rtcMinutesThisMonth: secondsToMinutes(rtcSumByUser.get(user.id) ?? 0),
        chatMessagesThisMonth: chatCountsByOwner.get(user.id) ?? 0,
        liveMinutesThisMonth: secondsToMinutes(liveSumByUser.get(user.id) ?? 0),
        apiEventsThisMonth: apiEventsByUser.get(user.id) ?? 0,
        riskLevel,
        authProviders: authProvidersFor(user),
      };
    });
  }

  /**
   * Full detail payload for one developer: header, every tab's data, in a
   * single response. Chosen over splitting into `/:id/activity`,
   * `/:id/projects` etc. because every list inside is already capped
   * (100 activity rows, 100 security rows, 200 projects) — the payload
   * stays small and the frontend gets every tab from one request instead
   * of one per tab click.
   */
  async detail(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: DEVELOPER_SELECT });
    if (!user) {
      throw new NotFoundException('Developer not found');
    }

    const monthStart = startOfCurrentMonthUtc();

    const [
      memberships,
      lastActiveEvent,
      allowances,
      recentActivity,
      recentSecurity,
      recentErrors,
      rtcSumRow,
      liveSumRow,
    ] = await Promise.all([
      this.prisma.projectMember.findMany({
        where: { userId: id },
        include: { project: true },
        orderBy: { project: { createdAt: 'desc' } },
        take: PROJECTS_LIST_CAP,
      }),
      this.prisma.activityEvent.findFirst({ where: { developerId: id }, orderBy: { createdAt: 'desc' } }),
      this.prisma.usageAllowance.findMany({ where: { userId: id } }),
      this.activityEvents.timelineForDeveloper(id, ACTIVITY_TAB_LIMIT),
      this.prisma.activityEvent.findMany({
        where: { developerId: id, eventType: { in: SECURITY_EVENT_TYPES } },
        orderBy: { createdAt: 'desc' },
        take: SECURITY_TAB_LIMIT,
      }),
      this.prisma.errorEvent.findMany({
        where: { project: { ownerId: id } },
        orderBy: { timestamp: 'desc' },
        take: OVERVIEW_RECENT_LIMIT,
      }),
      this.prisma.usageSession.aggregate({
        where: { userId: id, product: 'RTC', startedAt: { gte: monthStart } },
        _sum: { meteredSeconds: true },
      }),
      this.prisma.usageSession.aggregate({
        where: { userId: id, product: 'LIVE_STREAMING', startedAt: { gte: monthStart } },
        _sum: { meteredSeconds: true },
      }),
    ]);

    // `Message` carries `projectId` as a plain scalar with no declared Prisma
    // relation (only `ErrorEvent` has that), so "chat usage" is scoped to
    // owned projects the same way the list view is: by id, not by relation.
    const ownedProjectIds = memberships.filter((m) => m.project.ownerId === id).map((m) => m.projectId);
    const chatCountThisMonth =
      ownedProjectIds.length === 0
        ? 0
        : await this.prisma.message.count({
            where: { projectId: { in: ownedProjectIds }, createdAt: { gte: monthStart } },
          });

    const projects = await this.buildProjectRows(memberships);

    const loginFailedLast24h = await this.prisma.activityEvent.count({
      where: {
        developerId: id,
        eventType: ActivityEventType.LOGIN_FAILED,
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    });
    const suspiciousLast7d = await this.prisma.activityEvent.count({
      where: {
        developerId: id,
        eventType: { in: [ActivityEventType.SUSPICIOUS_ACTIVITY, ActivityEventType.RATE_LIMIT_TRIGGERED] },
        createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
    });

    const apiEventsThisMonth = await this.prisma.activityEvent.count({
      where: { developerId: id, createdAt: { gte: monthStart } },
    });

    const riskLevel = deriveRiskLevel({
      suspended: user.status === 'SUSPENDED',
      loginFailedLast24h,
      suspiciousLast7d,
    });

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      status: user.status,
      createdAt: user.createdAt.toISOString(),
      suspendedAt: user.suspendedAt?.toISOString() ?? null,
      suspendedReason: user.suspendedReason,
      platformRole: user.platformRole,
      authProviders: authProvidersFor(user),
      lastActiveAt: (lastActiveEvent?.createdAt ?? null)?.toISOString() ?? null,
      riskLevel,
      plan: allowances.map((a) => ({
        product: a.product,
        source: a.source,
        includedMinutes: a.includedMinutes,
        consumedMinutes: secondsToMinutes(a.consumedSeconds),
        includedCount: a.includedCount,
        consumedCount: a.consumedCount,
        exhaustedAt: a.exhaustedAt?.toISOString() ?? null,
      })),
      usage: {
        rtcMinutesThisMonth: secondsToMinutes(rtcSumRow._sum.meteredSeconds ?? 0),
        liveMinutesThisMonth: secondsToMinutes(liveSumRow._sum.meteredSeconds ?? 0),
        chatMessagesThisMonth: chatCountThisMonth,
        apiEventsThisMonth,
      },
      overview: {
        recentProjects: projects.slice(0, OVERVIEW_RECENT_LIMIT),
        recentActivity: recentActivity.slice(0, 10).map(serializeActivityEvent),
        recentErrors: recentErrors.map((e) => ({
          id: e.publicId,
          category: e.category,
          message: e.message,
          timestamp: e.timestamp.toISOString(),
        })),
        recentSecurityEvents: recentSecurity.slice(0, OVERVIEW_RECENT_LIMIT).map(serializeActivityEvent),
      },
      projects,
      activity: recentActivity.map(serializeActivityEvent),
      security: recentSecurity.map(serializeActivityEvent),
    };
  }

  private async buildProjectRows(memberships: (ProjectMember & { project: Project })[]) {
    const projectIds = memberships.map((m) => m.projectId);
    if (projectIds.length === 0) return [];

    const [rtcByProject, liveByProject, chatByProject, apiByProject] = await Promise.all([
      this.prisma.usageSession.groupBy({
        by: ['projectId'],
        where: { projectId: { in: projectIds }, product: 'RTC' },
        _sum: { meteredSeconds: true },
      }),
      this.prisma.usageSession.groupBy({
        by: ['projectId'],
        where: { projectId: { in: projectIds }, product: 'LIVE_STREAMING' },
        _sum: { meteredSeconds: true },
      }),
      this.prisma.message.groupBy({
        by: ['projectId'],
        where: { projectId: { in: projectIds } },
        _count: { _all: true },
      }),
      this.prisma.activityEvent.groupBy({
        by: ['projectId'],
        where: { projectId: { in: projectIds } },
        _count: { _all: true },
      }),
    ]);

    const rtcMap = new Map(rtcByProject.map((r) => [r.projectId, r._sum.meteredSeconds ?? 0]));
    const liveMap = new Map(liveByProject.map((r) => [r.projectId, r._sum.meteredSeconds ?? 0]));
    const chatMap = new Map(chatByProject.map((r) => [r.projectId, r._count._all]));
    const apiMap = new Map(apiByProject.map((r) => [r.projectId as string, r._count._all]));

    return memberships.map((m) => ({
      id: m.project.id,
      name: m.project.name,
      status: m.project.status,
      createdAt: m.project.createdAt.toISOString(),
      role: m.role,
      isOwner: m.project.ownerId === m.userId,
      rtcMinutes: secondsToMinutes(rtcMap.get(m.projectId) ?? 0),
      liveMinutes: secondsToMinutes(liveMap.get(m.projectId) ?? 0),
      chatMessages: chatMap.get(m.projectId) ?? 0,
      apiEvents: apiMap.get(m.projectId) ?? 0,
    }));
  }

  /** The admin audit entry is written by the controller (it needs the current admin + request context, which this service intentionally has no access to). */
  async suspend(id: string, reason: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!user) throw new NotFoundException('Developer not found');
    if (user.status === 'SUSPENDED') throw new ConflictException('This account is already suspended');

    const now = new Date();
    await this.prisma.user.update({
      where: { id },
      data: { status: 'SUSPENDED', suspendedAt: now, suspendedReason: reason },
    });

    return { id, status: 'SUSPENDED' as const, suspendedAt: now.toISOString(), suspendedReason: reason };
  }

  async unsuspend(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!user) throw new NotFoundException('Developer not found');
    if (user.status === 'ACTIVE') throw new ConflictException('This account is not suspended');

    await this.prisma.user.update({
      where: { id },
      data: { status: 'ACTIVE', suspendedAt: null, suspendedReason: null },
    });

    return { id, status: 'ACTIVE' as const };
  }
}

function startOfCurrentMonthUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function secondsToMinutes(seconds: number): number {
  return Math.round((seconds / 60) * 10) / 10;
}

function authProvidersFor(user: Pick<DeveloperRow, 'authAccounts' | 'passwordHash'>): string[] {
  const providers = user.authAccounts.map((a) => a.provider as string);
  if (user.passwordHash) providers.push('EMAIL_PASSWORD');
  return providers;
}

function deriveRiskLevel(input: {
  suspended: boolean;
  loginFailedLast24h: number;
  suspiciousLast7d: number;
}): RiskLevel {
  if (input.suspended) return 'CRITICAL';
  if (input.loginFailedLast24h >= 5) return 'HIGH';
  if (input.suspiciousLast7d > 0) return 'MEDIUM';
  return 'LOW';
}

function serializeActivityEvent(e: ActivityEvent) {
  return {
    id: e.publicId,
    eventType: e.eventType,
    actorType: e.actorType,
    actorEmail: e.actorEmail,
    resourceType: e.resourceType,
    resourceId: e.resourceId,
    success: e.success,
    createdAt: e.createdAt.toISOString(),
    metadata: e.metadata,
  };
}
