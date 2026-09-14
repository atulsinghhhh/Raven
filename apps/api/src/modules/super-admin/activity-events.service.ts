import { Injectable, Logger } from '@nestjs/common';
import { ActivityActorType, ActivityEvent, ActivityEventType, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { generateId } from '../../shared/utils/crypto.util';

export interface ActivityEventEntry {
  eventType: ActivityEventType;
  actorType: ActivityActorType;
  actorId?: string | null;
  actorEmail?: string | null;
  resourceType?: string;
  resourceId?: string;
  projectId?: string | null;
  /** Whose timeline this shows up on — usually the resource owner. Falls back to `actorId` when omitted. */
  developerId?: string | null;
  success?: boolean;
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
  /** Never credentials, never message/chat content. */
  metadata?: Record<string, unknown>;
}

export interface ActivityEventQuery {
  developerId?: string;
  projectId?: string;
  eventType?: ActivityEventType;
  actorType?: ActivityActorType;
  success?: boolean;
  ipAddress?: string;
  requestId?: string;
  resourceId?: string;
  /** Matches developer or actor email, case-insensitive substring. */
  search?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

export interface ActivityEventPage {
  items: ActivityEvent[];
  total: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Cross-product business/security event stream: the developer activity
 * timeline (§6/§20) and the Global Activity Explorer (§8) both read this.
 *
 * Same failure contract as `AuditService`: by the time this is called the
 * underlying action has already happened, so a logging failure is caught
 * and logged rather than allowed to fail the request that triggered it —
 * a missing timeline entry is a gap, not an incident.
 *
 * Deliberately no update/delete: an activity stream a caller can rewrite
 * is worth less than none.
 */
@Injectable()
export class ActivityEventsService {
  private readonly logger = new Logger(ActivityEventsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: ActivityEventEntry): Promise<void> {
    try {
      await this.prisma.activityEvent.create({
        data: {
          publicId: generateId('evt'),
          eventType: entry.eventType,
          actorType: entry.actorType,
          actorId: entry.actorId ?? undefined,
          actorEmail: entry.actorEmail ?? undefined,
          resourceType: entry.resourceType,
          resourceId: entry.resourceId,
          projectId: entry.projectId ?? undefined,
          developerId: entry.developerId ?? entry.actorId ?? undefined,
          success: entry.success ?? true,
          requestId: entry.requestId,
          ipAddress: entry.ipAddress,
          userAgent: entry.userAgent,
          metadata: entry.metadata as Prisma.InputJsonValue | undefined,
        },
      });
    } catch (err) {
      this.logger.error(`failed to record activity event ${entry.eventType}: ${(err as Error).message}`);
    }
  }

  async list(query: ActivityEventQuery = {}): Promise<ActivityEventPage> {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = Math.max(query.offset ?? 0, 0);

    const where: Prisma.ActivityEventWhereInput = {
      ...(query.developerId ? { developerId: query.developerId } : {}),
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.eventType ? { eventType: query.eventType } : {}),
      ...(query.actorType ? { actorType: query.actorType } : {}),
      ...(query.success !== undefined ? { success: query.success } : {}),
      ...(query.ipAddress ? { ipAddress: query.ipAddress } : {}),
      ...(query.requestId ? { requestId: query.requestId } : {}),
      ...(query.resourceId ? { resourceId: query.resourceId } : {}),
      ...(query.search
        ? {
            OR: [
              { actorEmail: { contains: query.search, mode: 'insensitive' } },
              { resourceId: { contains: query.search, mode: 'insensitive' } },
              { requestId: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.activityEvent.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset }),
      this.prisma.activityEvent.count({ where }),
    ]);

    return { items, total };
  }

  /** One developer's timeline (§6/§20) — newest first, capped. */
  async timelineForDeveloper(developerId: string, limit = 100): Promise<ActivityEvent[]> {
    return this.prisma.activityEvent.findMany({
      where: { developerId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, MAX_LIMIT),
    });
  }

  async timelineForProject(projectId: string, limit = 100): Promise<ActivityEvent[]> {
    return this.prisma.activityEvent.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, MAX_LIMIT),
    });
  }
}
