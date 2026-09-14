import { Injectable, Logger } from '@nestjs/common';
import { AdminAuditLog, ActivityActorType, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { generateId } from '../../shared/utils/crypto.util';
import { AuditContext } from '../audit/audit-context.decorator';
import { ADMIN_ACTION_EVENT_TYPE, AdminAction, AdminTargetType } from './admin-audit.constants';
import { ActivityEventsService } from './activity-events.service';

export interface AdminAuditEntry {
  admin: { id: string; email: string };
  action: AdminAction;
  targetType: AdminTargetType;
  targetId?: string;
  /** Required at the call site for every mutating action (§9) — a suspend/limit-change/role-grant with no stated reason should not compile at the caller. Read-only entries like "viewed" pass `undefined`. */
  reason?: string;
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  context?: AuditContext;
}

export interface AdminAuditQuery {
  adminId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

export interface AdminAuditPage {
  items: AdminAuditLog[];
  total: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * The immutable log of what Raven *administrators* did (§9) — distinct
 * from `ActivityEvent`, which is the cross-product developer/business
 * stream. Never store secrets in `metadata`/`beforeState`/`afterState`:
 * callers are responsible for redacting before they get here, the same
 * discipline `AuditService` already asks of project-scoped callers.
 *
 * Every write also mirrors into `ActivityEvent` (see `admin-audit.constants`)
 * so an admin action is visible from both the dedicated Audit Logs page and
 * the unified Global Activity Explorer, without keeping two independent
 * sources of truth for "did this happen."
 */
@Injectable()
export class AdminAuditService {
  private readonly logger = new Logger(AdminAuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activityEvents: ActivityEventsService,
  ) {}

  async record(entry: AdminAuditEntry): Promise<void> {
    try {
      await this.prisma.adminAuditLog.create({
        data: {
          publicId: generateId('aad'),
          adminId: entry.admin.id,
          adminEmail: entry.admin.email,
          action: entry.action,
          targetType: entry.targetType,
          targetId: entry.targetId,
          reason: entry.reason,
          beforeState: entry.beforeState as Prisma.InputJsonValue | undefined,
          afterState: entry.afterState as Prisma.InputJsonValue | undefined,
          metadata: entry.metadata as Prisma.InputJsonValue | undefined,
          requestId: entry.context?.requestId,
          ipAddress: entry.context?.ipAddress,
          userAgent: entry.context?.userAgent,
        },
      });
    } catch (err) {
      this.logger.error(`failed to record admin audit entry ${entry.action} for ${entry.targetType}: ${(err as Error).message}`);
    }

    await this.activityEvents.record({
      eventType: ADMIN_ACTION_EVENT_TYPE[entry.action] ?? 'ADMIN_ACTION',
      actorType: ActivityActorType.ADMIN,
      actorId: entry.admin.id,
      actorEmail: entry.admin.email,
      resourceType: entry.targetType,
      resourceId: entry.targetId,
      developerId: entry.targetType === AdminTargetType.User ? entry.targetId : undefined,
      requestId: entry.context?.requestId,
      ipAddress: entry.context?.ipAddress,
      userAgent: entry.context?.userAgent,
      metadata: { action: entry.action, reason: entry.reason, ...entry.metadata },
    });
  }

  async list(query: AdminAuditQuery = {}): Promise<AdminAuditPage> {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = Math.max(query.offset ?? 0, 0);

    const where: Prisma.AdminAuditLogWhereInput = {
      ...(query.adminId ? { adminId: query.adminId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.targetType ? { targetType: query.targetType } : {}),
      ...(query.targetId ? { targetId: query.targetId } : {}),
      ...(query.from || query.to
        ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.adminAuditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset }),
      this.prisma.adminAuditLog.count({ where }),
    ]);

    return { items, total };
  }
}
