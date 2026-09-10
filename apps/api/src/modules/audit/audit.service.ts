import { Injectable, Logger } from '@nestjs/common';
import { AuditLog } from '../../generated/prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { Environment } from '../../shared/environment/environment.constants';
import { generateId } from '../../shared/utils/crypto.util';
import { AuditAction, AuditResource } from './audit.constants';
import { AuditContext } from './audit-context.decorator';

export interface AuditEntry {
  projectId: string;
  actor: { id: string | null; email: string };
  action: AuditAction;
  resourceType: AuditResource;
  resourceId?: string;
  environment?: Environment;
  /** Context a reader will want. Never credentials, never message bodies. */
  metadata?: Record<string, unknown>;
  context?: AuditContext;
}

export interface AuditQuery {
  action?: string;
  actorId?: string;
  resourceId?: string;
  limit?: number;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records an action that has already happened.
   *
   * Awaited by callers, but a failure here is logged and swallowed rather
   * than thrown. The alternative is worse: the mutation has already
   * committed by this point, so reporting failure would tell the caller
   * their key was not created when it was, and a retry would create a
   * second one. A missing audit row is a gap; a duplicated production key
   * is an incident.
   *
   * The failure is logged at error level precisely because it should never
   * happen quietly: an audit trail that silently stops recording is worth
   * less than no audit trail at all.
   */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          publicId: generateId('aud'),
          projectId: entry.projectId,
          environment: entry.environment,
          actorId: entry.actor.id,
          actorEmail: entry.actor.email,
          action: entry.action,
          resourceType: entry.resourceType,
          resourceId: entry.resourceId,
          metadata: entry.metadata as object | undefined,
          requestId: entry.context?.requestId,
          ipAddress: entry.context?.ipAddress,
          userAgent: entry.context?.userAgent,
        },
      });
    } catch (err) {
      this.logger.error(
        `failed to record audit entry ${entry.action} for project ${entry.projectId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Newest first, capped. There is on purpose no update or delete
   * anywhere in this service: the table is append-only, and an audit log
   * an administrator can edit is not an audit log.
   */
  async list(projectId: string, query: AuditQuery = {}): Promise<AuditLog[]> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);

    return this.prisma.auditLog.findMany({
      where: {
        projectId,
        ...(query.action ? { action: query.action } : {}),
        ...(query.actorId ? { actorId: query.actorId } : {}),
        ...(query.resourceId ? { resourceId: query.resourceId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
