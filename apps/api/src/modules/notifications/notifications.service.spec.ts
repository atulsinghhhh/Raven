import { NotificationType } from '../../generated/prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotFoundError } from '../../shared/errors/app-error';
import { Environment } from '../../shared/environment/environment.constants';
import { DashboardEventsService } from '../dashboard-ws/realtime/dashboard-events.service';
import { NotificationsService } from './notifications.service';

const SCOPE = { projectId: 'project-1', environment: Environment.PRODUCTION };

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'row-uuid-1',
    publicId: 'notif_abc',
    userId: 'user-1',
    projectId: 'project-1',
    type: NotificationType.WEBHOOK_DELIVERY_FAILED,
    title: 'Webhook delivery failing',
    message: 'https://example.com/hook has failed 3 times in a row.',
    payload: { endpointId: 'whe_abc' },
    dedupeKey: 'webhook:delivery_failed:whe_abc',
    read: false,
    readAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: {
    projectMember: { findMany: jest.Mock };
    notification: {
      upsert: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      count: jest.Mock;
    };
  };
  let dashboardEvents: { publish: jest.Mock };

  beforeEach(() => {
    prisma = {
      projectMember: { findMany: jest.fn().mockResolvedValue([{ userId: 'user-1' }]) },
      notification: {
        upsert: jest.fn().mockResolvedValue(row()),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    dashboardEvents = { publish: jest.fn().mockResolvedValue(undefined) };
    service = new NotificationsService(
      prisma as unknown as PrismaService,
      dashboardEvents as unknown as DashboardEventsService,
    );
  });

  describe('notifyProject — creation, persistence, and fan-out scope', () => {
    it('upserts one notification per active project member, keyed on (userId, dedupeKey)', async () => {
      prisma.projectMember.findMany.mockResolvedValue([{ userId: 'user-1' }, { userId: 'user-2' }]);

      await service.notifyProject(SCOPE, {
        type: NotificationType.WEBHOOK_DELIVERY_FAILED,
        dedupeKey: 'webhook:delivery_failed:whe_abc',
        title: 'Webhook delivery failing',
        message: 'it failed',
        payload: { endpointId: 'whe_abc' },
      });

      expect(prisma.projectMember.findMany).toHaveBeenCalledWith({
        where: { projectId: 'project-1' },
        select: { userId: true },
      });
      expect(prisma.notification.upsert).toHaveBeenCalledTimes(2);
      expect(prisma.notification.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId_dedupeKey: { userId: 'user-1', dedupeKey: 'webhook:delivery_failed:whe_abc' } },
        }),
      );
      expect(prisma.notification.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId_dedupeKey: { userId: 'user-2', dedupeKey: 'webhook:delivery_failed:whe_abc' } },
        }),
      );
    });

    it('the create branch persists projectId, type, title, message, payload, and a generated publicId', async () => {
      await service.notifyProject(SCOPE, {
        type: NotificationType.LIVE_STREAM_STARTED,
        dedupeKey: 'live_stream:started:stream_1',
        title: 'Live stream started',
        message: '"Launch Day" is now live.',
        payload: { streamId: 'stream_1' },
      });

      const call = prisma.notification.upsert.mock.calls[0][0];
      expect(call.create).toEqual(
        expect.objectContaining({
          userId: 'user-1',
          projectId: 'project-1',
          type: NotificationType.LIVE_STREAM_STARTED,
          title: 'Live stream started',
          message: '"Launch Day" is now live.',
          payload: { streamId: 'stream_1' },
          dedupeKey: 'live_stream:started:stream_1',
        }),
      );
      expect(call.create.publicId).toMatch(/^notif_/);
    });

    it('the update branch (a recurring incident) resets read state and bumps createdAt, rather than leaving a dismissed notification silently stale', async () => {
      await service.notifyProject(SCOPE, {
        type: NotificationType.WEBHOOK_DELIVERY_FAILED,
        dedupeKey: 'webhook:delivery_failed:whe_abc',
        title: 'Webhook delivery failing',
        message: 'failing again',
      });

      const call = prisma.notification.upsert.mock.calls[0][0];
      expect(call.update).toEqual(
        expect.objectContaining({
          title: 'Webhook delivery failing',
          message: 'failing again',
          read: false,
          readAt: null,
          createdAt: expect.any(Date),
        }),
      );
    });

    it('does nothing and publishes nothing when the project has no members', async () => {
      prisma.projectMember.findMany.mockResolvedValue([]);

      await service.notifyProject(SCOPE, {
        type: NotificationType.LIVE_STREAM_ENDED,
        dedupeKey: 'live_stream:ended:stream_1',
        title: 'Live stream ended',
        message: 'ended',
      });

      expect(prisma.notification.upsert).not.toHaveBeenCalled();
      expect(dashboardEvents.publish).not.toHaveBeenCalled();
    });

    it('publishes notification.created exactly once per call, regardless of member count', async () => {
      prisma.projectMember.findMany.mockResolvedValue([{ userId: 'user-1' }, { userId: 'user-2' }, { userId: 'user-3' }]);

      await service.notifyProject(SCOPE, {
        type: NotificationType.WEBHOOK_ENDPOINT_DISABLED,
        dedupeKey: 'webhook:endpoint_disabled:whe_abc',
        title: 'Webhook endpoint disabled',
        message: 'disabled',
      });

      expect(dashboardEvents.publish).toHaveBeenCalledTimes(1);
      expect(dashboardEvents.publish).toHaveBeenCalledWith('project-1', { type: 'notification.created' });
    });

    it("one member's upsert failure does not prevent the others from being notified, and does not throw", async () => {
      prisma.projectMember.findMany.mockResolvedValue([{ userId: 'user-1' }, { userId: 'user-2' }]);
      prisma.notification.upsert
        .mockRejectedValueOnce(new Error('db blip'))
        .mockResolvedValueOnce(row({ userId: 'user-2' }));

      await expect(
        service.notifyProject(SCOPE, {
          type: NotificationType.LIVE_STREAM_STARTED,
          dedupeKey: 'live_stream:started:stream_1',
          title: 'Live stream started',
          message: 'live',
        }),
      ).resolves.toBeUndefined();

      expect(prisma.notification.upsert).toHaveBeenCalledTimes(2);
      // Still nudges the project even though one member's write failed —
      // the members who did get their row should still be told to refetch.
      expect(dashboardEvents.publish).toHaveBeenCalledTimes(1);
    });
  });

  describe('list — cursor pagination, scoped to (userId, projectId)', () => {
    it('always filters by the given userId and projectId', async () => {
      await service.list('user-1', 'project-1', {});

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1', projectId: 'project-1' } }),
      );
    });

    it('adds a read:false filter when unreadOnly is set', async () => {
      await service.list('user-1', 'project-1', { unreadOnly: true });

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1', projectId: 'project-1', read: false } }),
      );
    });

    it('requests one extra row and reports hasMore true when a next page exists', async () => {
      prisma.notification.findMany.mockResolvedValue([row({ publicId: 'notif_1' }), row({ publicId: 'notif_2' }), row({ publicId: 'notif_3' })]);

      const result = await service.list('user-1', 'project-1', { limit: 2 });

      expect(result.data).toHaveLength(2);
      expect(result.data.map((n) => n.id)).toEqual(['notif_1', 'notif_2']);
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBe('notif_2');
    });

    it('reports hasMore false and nextCursor null at the end of the dataset', async () => {
      prisma.notification.findMany.mockResolvedValue([row()]);

      const result = await service.list('user-1', 'project-1', { limit: 5 });

      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
    });

    it('cursors by the given publicId and skips the cursor row itself', async () => {
      await service.list('user-1', 'project-1', { limit: 20, cursor: 'notif_last' });

      const call = prisma.notification.findMany.mock.calls[0][0];
      expect(call.cursor).toEqual({ publicId: 'notif_last' });
      expect(call.skip).toBe(1);
    });

    it('orders by createdAt desc with publicId desc as a deterministic tiebreak', async () => {
      await service.list('user-1', 'project-1', {});

      const call = prisma.notification.findMany.mock.calls[0][0];
      expect(call.orderBy).toEqual([{ createdAt: 'desc' }, { publicId: 'desc' }]);
    });

    it('never exposes the internal database id — only the public id, as "id"', async () => {
      prisma.notification.findMany.mockResolvedValue([row()]);

      const result = await service.list('user-1', 'project-1', {});

      expect(result.data[0].id).toBe('notif_abc');
      expect(result.data[0]).not.toHaveProperty('publicId');
    });
  });

  describe('unreadCount', () => {
    it('counts only unread rows scoped to (userId, projectId)', async () => {
      prisma.notification.count.mockResolvedValue(4);

      const count = await service.unreadCount('user-1', 'project-1');

      expect(count).toBe(4);
      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: { userId: 'user-1', projectId: 'project-1', read: false },
      });
    });
  });

  describe('markRead — recipient/project authorization', () => {
    it('marks a notification read and stamps readAt', async () => {
      prisma.notification.findUnique.mockResolvedValue(row({ read: false }));
      prisma.notification.update.mockResolvedValue(row({ read: true, readAt: new Date('2026-01-02T00:00:00.000Z') }));

      const result = await service.markRead('user-1', 'project-1', 'notif_abc');

      expect(prisma.notification.update).toHaveBeenCalledWith({
        where: { id: 'row-uuid-1' },
        data: { read: true, readAt: expect.any(Date) },
      });
      expect(result.read).toBe(true);
    });

    it('is idempotent — marking an already-read notification read again is a no-op update', async () => {
      prisma.notification.findUnique.mockResolvedValue(row({ read: true, readAt: new Date('2026-01-01T00:05:00.000Z') }));

      await service.markRead('user-1', 'project-1', 'notif_abc');

      expect(prisma.notification.update).not.toHaveBeenCalled();
    });

    it('404s when the notification does not exist', async () => {
      prisma.notification.findUnique.mockResolvedValue(null);

      await expect(service.markRead('user-1', 'project-1', 'notif_missing')).rejects.toBeInstanceOf(NotFoundError);
    });

    it('404s when the notification belongs to a different user — never leaks that it exists for someone else', async () => {
      prisma.notification.findUnique.mockResolvedValue(row({ userId: 'someone-else' }));

      await expect(service.markRead('user-1', 'project-1', 'notif_abc')).rejects.toBeInstanceOf(NotFoundError);
      expect(prisma.notification.update).not.toHaveBeenCalled();
    });

    it('404s when the notification belongs to a different project than the one in the URL', async () => {
      prisma.notification.findUnique.mockResolvedValue(row({ projectId: 'a-different-project' }));

      await expect(service.markRead('user-1', 'project-1', 'notif_abc')).rejects.toBeInstanceOf(NotFoundError);
      expect(prisma.notification.update).not.toHaveBeenCalled();
    });
  });

  describe('markAllRead', () => {
    it('updates only the caller\'s own unread rows for this project', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 3 });

      const result = await service.markAllRead('user-1', 'project-1');

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', projectId: 'project-1', read: false },
        data: { read: true, readAt: expect.any(Date) },
      });
      expect(result).toEqual({ count: 3 });
    });
  });
});
