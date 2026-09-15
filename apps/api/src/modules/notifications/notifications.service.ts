import { Injectable, Logger } from '@nestjs/common';
import { Notification, NotificationType } from '../../generated/prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotFoundError } from '../../shared/errors/app-error';
import { RavenErrorCode } from '../../shared/errors/error-codes';
import { generateId } from '../../shared/utils/crypto.util';
import { ProjectScope } from '../../shared/environment/environment.constants';
import { DashboardWsEventType } from '../dashboard-ws/dashboard-ws-events';
import { DashboardEventsService } from '../dashboard-ws/realtime/dashboard-events.service';
import { toJsonInput } from './json.util';

export interface NotificationView {
  id: string;
  projectId: string | null;
  type: NotificationType;
  title: string;
  message: string;
  payload: Record<string, unknown> | null;
  read: boolean;
  readAt: string | null;
  createdAt: string;
}

export interface ListNotificationsResult {
  data: NotificationView[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** What a producer (WebhookDeliveryWorker, LiveStreamsService, …) hands notifyProject(). */
export interface NotifyProjectInput {
  type: NotificationType;
  /**
   * The idempotency key (spec §7): notifyProject() upserts on
   * `(userId, dedupeKey)` rather than inserting unconditionally, so a
   * recurring incident (the same endpoint failing again, a second
   * disablement after being re-enabled) refreshes one row per recipient
   * instead of spawning a new one per occurrence. Callers are responsible
   * for making this specific enough to the underlying resource — see the
   * call sites in webhook-delivery.worker.ts and live-streams.service.ts
   * for the exact scheme each type uses.
   */
  dedupeKey: string;
  title: string;
  message: string;
  payload?: Record<string, unknown>;
}

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;

/**
 * Real, persistent, per-recipient dashboard notifications (Phase 5F) —
 * replacing NotificationsBell's previous behavior of re-deriving a fake
 * list from diagnostics/webhooks/audit logs on every page render, with no
 * read state and nothing that survives a reload (Phase 5A's finding).
 *
 * The database is authoritative (spec §6): every mutating method here
 * either writes Postgres and returns what it wrote, or reads it back
 * directly. `notifyProject()`'s realtime publish is the *last* step, after
 * the write has already committed, and is fire-and-forget in the same
 * fail-open posture every other DashboardEventsService.publish() call in
 * this codebase already takes — a missed nudge is recovered by the next
 * REST fetch, never by a replay mechanism (spec §6's own instruction not
 * to build one unless the architecture requires it, and it doesn't: REST
 * is already a complete, correct recovery path).
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dashboardEvents: DashboardEventsService,
  ) {}

  /**
   * Fans out one notification to every active member of a project,
   * upserting per recipient on `(userId, dedupeKey)` so a repeat trigger
   * for the same incident refreshes an existing row — bumping it back to
   * unread and to the top of the list — rather than accumulating
   * duplicates. Individual upsert failures are logged and skipped, never
   * thrown: one member's write failing must not cost every other member
   * their notification, the same reasoning ChatEventsService.publish and
   * every other side-effect in this codebase already applies.
   *
   * Awaited by callers (unlike the ephemeral dashboard-ws nudges
   * elsewhere), because persistence here is the authoritative step, not
   * a courtesy — see the class doc. The realtime publish inside this
   * method is still fire-and-forget; only the database write is awaited.
   */
  async notifyProject(scope: ProjectScope, input: NotifyProjectInput): Promise<void> {
    const members = await this.prisma.projectMember.findMany({
      where: { projectId: scope.projectId },
      select: { userId: true },
    });
    if (members.length === 0) {
      return;
    }

    const payload = toJsonInput(input.payload);

    await Promise.all(
      members.map(async (member) => {
        try {
          await this.prisma.notification.upsert({
            where: { userId_dedupeKey: { userId: member.userId, dedupeKey: input.dedupeKey } },
            create: {
              publicId: generateId('notif'),
              userId: member.userId,
              projectId: scope.projectId,
              type: input.type,
              title: input.title,
              message: input.message,
              payload,
              dedupeKey: input.dedupeKey,
            },
            update: {
              title: input.title,
              message: input.message,
              payload,
              // A recurring incident is worth surfacing again, even if the
              // developer already read and dismissed the last one.
              read: false,
              readAt: null,
              createdAt: new Date(),
            },
          });
        } catch (err) {
          this.logger.error(
            `failed to persist notification (${input.type}) for user ${member.userId}: ${(err as Error).message}`,
          );
        }
      }),
    );

    // One nudge per project, not one per fanned-out row: every connected
    // socket for this project refetches its own notifications regardless
    // of which member it belongs to. See the type's doc comment in
    // dashboard-ws-events.ts for why the payload carries nothing else.
    void this.dashboardEvents.publish(scope.projectId, { type: DashboardWsEventType.NotificationCreated });
  }

  /**
   * A recipient's own project-scoped notifications, newest first,
   * cursor-paginated by publicId exactly like
   * ConnectionsService.listForProjectPaginated — createdAt alone isn't a
   * stable sort under concurrent fan-out writes in the same millisecond.
   */
  async list(
    userId: string,
    projectId: string,
    query: { limit?: number; cursor?: string; unreadOnly?: boolean },
  ): Promise<ListNotificationsResult> {
    const limit = Math.min(query.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);

    const rows = await this.prisma.notification.findMany({
      where: { userId, projectId, ...(query.unreadOnly ? { read: false } : {}) },
      orderBy: [{ createdAt: 'desc' }, { publicId: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { publicId: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? data[data.length - 1].publicId : null;

    return { data: data.map((row) => this.toView(row)), nextCursor, hasMore };
  }

  async unreadCount(userId: string, projectId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, projectId, read: false } });
  }

  /**
   * Scoped to `(userId, projectId, publicId)` all three at once — not
   * just publicId — so a caller can never mark another member's
   * notification read, or one from a project they merely happen to know
   * the id of. A miss is reported as not-found, the same
   * indistinguishable-from-nonexistent rule every other resource in this
   * codebase applies, since confirming "that id exists, just not for you"
   * would leak more than a 404 does.
   */
  async markRead(userId: string, projectId: string, publicId: string): Promise<NotificationView> {
    const notification = await this.findOwn(userId, projectId, publicId);
    if (notification.read) {
      return this.toView(notification);
    }
    const updated = await this.prisma.notification.update({
      where: { id: notification.id },
      data: { read: true, readAt: new Date() },
    });
    return this.toView(updated);
  }

  async markAllRead(userId: string, projectId: string): Promise<{ count: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, projectId, read: false },
      data: { read: true, readAt: new Date() },
    });
    return { count: result.count };
  }

  private async findOwn(userId: string, projectId: string, publicId: string): Promise<Notification> {
    const notification = await this.prisma.notification.findUnique({ where: { publicId } });
    if (!notification || notification.userId !== userId || notification.projectId !== projectId) {
      throw new NotFoundError('Notification', RavenErrorCode.NOT_FOUND);
    }
    return notification;
  }

  private toView(notification: Notification): NotificationView {
    return {
      id: notification.publicId,
      projectId: notification.projectId,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      payload: (notification.payload as Record<string, unknown> | null) ?? null,
      read: notification.read,
      readAt: notification.readAt?.toISOString() ?? null,
      createdAt: notification.createdAt.toISOString(),
    };
  }
}
