import { BadRequestException, Injectable } from '@nestjs/common';
import { ActivityEventType, ApiKeyStatus, Environment, Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../shared/database/prisma.service';
import { ActivityEventPage, ActivityEventQuery, ActivityEventsService } from '../activity-events.service';
import { QueryApiKeysDto } from './dto/query-api-keys.dto';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * The only `ActivityEventType`s this domain's `/activity` route will ever
 * filter to. Deliberately not exported/shared with the generic Activity
 * Explorer's own constants file — this list exists to *restrict*, not to
 * describe every event type that exists.
 */
const API_ACTIVITY_EVENT_TYPES = [
  ActivityEventType.API_KEY_CREATED,
  ActivityEventType.API_KEY_REVOKED,
  ActivityEventType.API_REQUEST_FAILED,
  ActivityEventType.RATE_LIMIT_TRIGGERED,
] as const;

/**
 * What `GET /v1/super-admin/api/overview` actually reports. There is no
 * per-request log table in this codebase — `RequestLoggerMiddleware` only
 * emits a log line and `MetricsMiddleware` only feeds Prometheus counters,
 * neither persists a row to Postgres — so this deliberately does NOT
 * include request volume, success/failure rates, 4xx/5xx breakdowns,
 * latency, or top endpoints/projects/developers. Everything below is a
 * real query against `ApiKey` or `ActivityEvent`.
 */
export interface ApiOverviewResponse {
  generatedAt: string;
  keys: {
    total: number;
    active: number;
    revoked: number;
    createdToday: number;
    createdThisWeek: number;
  };
  /**
   * `ActivityEvent` counts, used as a proxy for "API activity" trend —
   * not a substitute for real request analytics, just what's real today.
   */
  activity: {
    apiKeyCreatedToday: number;
    apiKeyRevokedToday: number;
    apiRequestFailedToday: number;
    rateLimitTriggeredToday: number;
    rateLimitTriggeredTotal: number;
  };
}

export interface ApiKeyListItem {
  id: string;
  publicId: string;
  name: string | null;
  environment: Environment;
  status: ApiKeyStatus;
  lastUsedAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
  project: { id: string; name: string };
  owner: { email: string };
}

export interface ApiKeyListPage {
  items: ApiKeyListItem[];
  total: number;
}

export interface ApiActivityQuery {
  eventType?: ActivityEventType;
  projectId?: string;
  success?: boolean;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

function startOfDay(from: Date): Date {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfWeek(from: Date): Date {
  const d = startOfDay(from);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

/**
 * Real Prisma queries backing the Super Admin Portal's API operations
 * slice — API key lifecycle stats and the platform-wide key list. Never
 * selects `secretHash`, never touches the raw secret.
 */
@Injectable()
export class ApiOpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityEvents: ActivityEventsService,
  ) {}

  async getOverview(): Promise<ApiOverviewResponse> {
    const now = new Date();
    const today = startOfDay(now);
    const week = startOfWeek(now);

    const [
      total,
      active,
      revoked,
      createdToday,
      createdThisWeek,
      apiKeyCreatedToday,
      apiKeyRevokedToday,
      apiRequestFailedToday,
      rateLimitTriggeredToday,
      rateLimitTriggeredTotal,
    ] = await Promise.all([
      this.prisma.apiKey.count(),
      this.prisma.apiKey.count({ where: { status: ApiKeyStatus.ACTIVE } }),
      this.prisma.apiKey.count({ where: { status: ApiKeyStatus.REVOKED } }),
      this.prisma.apiKey.count({ where: { createdAt: { gte: today } } }),
      this.prisma.apiKey.count({ where: { createdAt: { gte: week } } }),
      this.prisma.activityEvent.count({
        where: { eventType: ActivityEventType.API_KEY_CREATED, createdAt: { gte: today } },
      }),
      this.prisma.activityEvent.count({
        where: { eventType: ActivityEventType.API_KEY_REVOKED, createdAt: { gte: today } },
      }),
      this.prisma.activityEvent.count({
        where: { eventType: ActivityEventType.API_REQUEST_FAILED, createdAt: { gte: today } },
      }),
      this.prisma.activityEvent.count({
        where: { eventType: ActivityEventType.RATE_LIMIT_TRIGGERED, createdAt: { gte: today } },
      }),
      this.prisma.activityEvent.count({ where: { eventType: ActivityEventType.RATE_LIMIT_TRIGGERED } }),
    ]);

    return {
      generatedAt: now.toISOString(),
      keys: { total, active, revoked, createdToday, createdThisWeek },
      activity: {
        apiKeyCreatedToday,
        apiKeyRevokedToday,
        apiRequestFailedToday,
        rateLimitTriggeredToday,
        rateLimitTriggeredTotal,
      },
    };
  }

  async listKeys(query: QueryApiKeysDto): Promise<ApiKeyListPage> {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = Math.max(query.offset ?? 0, 0);

    const where: Prisma.ApiKeyWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.environment ? { environment: query.environment } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.apiKey.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        // Deliberately never `secretHash`, same rule ApiKeysService follows
        // for the per-project view — a platform-wide list is not an excuse
        // to widen what's exposed.
        select: {
          id: true,
          publicId: true,
          name: true,
          environment: true,
          status: true,
          lastUsedAt: true,
          createdAt: true,
          revokedAt: true,
          project: { select: { id: true, name: true, owner: { select: { email: true } } } },
        },
      }),
      this.prisma.apiKey.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        publicId: row.publicId,
        name: row.name,
        environment: row.environment,
        status: row.status,
        lastUsedAt: row.lastUsedAt,
        createdAt: row.createdAt,
        revokedAt: row.revokedAt,
        project: { id: row.project.id, name: row.project.name },
        owner: { email: row.project.owner.email },
      })),
      total,
    };
  }

  /**
   * `ActivityEventsService.list()` only filters on a single `eventType`,
   * and nothing about that shared service should change just for this
   * secondary view. With one type given, this delegates straight through.
   * With none given, it fans out one `.list()` call per API-related type,
   * merges, and re-sorts locally — fine for a low-volume secondary view,
   * not meant to scale to deep pagination over a merged multi-type stream.
   */
  async listApiActivity(query: ApiActivityQuery): Promise<ActivityEventPage> {
    if (query.eventType && !(API_ACTIVITY_EVENT_TYPES as readonly ActivityEventType[]).includes(query.eventType)) {
      throw new BadRequestException(`eventType must be one of: ${API_ACTIVITY_EVENT_TYPES.join(', ')}`);
    }

    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = Math.max(query.offset ?? 0, 0);
    const common: Omit<ActivityEventQuery, 'eventType' | 'limit' | 'offset'> = {
      projectId: query.projectId,
      success: query.success,
      from: query.from,
      to: query.to,
    };

    if (query.eventType) {
      return this.activityEvents.list({ ...common, eventType: query.eventType, limit, offset });
    }

    const perTypeLimit = Math.min(offset + limit, MAX_LIMIT);
    const pages = await Promise.all(
      API_ACTIVITY_EVENT_TYPES.map((eventType) =>
        this.activityEvents.list({ ...common, eventType, limit: perTypeLimit }),
      ),
    );

    const merged = pages.flatMap((page) => page.items).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const total = pages.reduce((sum, page) => sum + page.total, 0);

    return { items: merged.slice(offset, offset + limit), total };
  }
}
