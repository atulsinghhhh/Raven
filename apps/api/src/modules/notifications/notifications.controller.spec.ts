import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ForbiddenError, NotFoundError } from '../../shared/errors/app-error';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { Capability } from '../projects/project-permissions';
import { ProjectsService } from '../projects/projects.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

const USER: AuthenticatedUser = { id: 'user-1', email: 'dev@example.com', jti: 'jti-1', exp: 0 };

function makeController(overrides: { authorize?: jest.Mock } = {}) {
  const authorize = overrides.authorize ?? jest.fn().mockResolvedValue({ project: {}, role: 'OWNER' });
  const list = jest.fn().mockResolvedValue({ data: [], nextCursor: null, hasMore: false });
  const unreadCount = jest.fn().mockResolvedValue(2);
  const markRead = jest.fn().mockResolvedValue({ id: 'notif_1', read: true });
  const markAllRead = jest.fn().mockResolvedValue({ count: 2 });

  const projectsService = { authorize } as unknown as ProjectsService;
  const notifications = { list, unreadCount, markRead, markAllRead } as unknown as NotificationsService;
  return {
    controller: new NotificationsController(projectsService, notifications),
    authorize,
    list,
    unreadCount,
    markRead,
    markAllRead,
  };
}

describe('NotificationsController', () => {
  it('requires an authenticated session (JwtAuthGuard applied at the class level)', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, NotificationsController) as unknown[] | undefined;
    expect(guards).toContain(JwtAuthGuard);
  });

  describe('list', () => {
    it('authorizes the caller for the project, with Capability.ProjectRead, before listing', async () => {
      const { controller, authorize, list } = makeController();

      await controller.list(USER, 'project-1', { limit: 20, unreadOnly: false });

      expect(authorize).toHaveBeenCalledWith('project-1', USER.id, Capability.ProjectRead);
      const authorizeOrder = authorize.mock.invocationCallOrder[0];
      const listOrder = list.mock.invocationCallOrder[0];
      expect(authorizeOrder).toBeLessThan(listOrder);
    });

    it("always lists the caller's own notifications — the userId comes from the session, never a request param", async () => {
      const { controller, list } = makeController();

      await controller.list(USER, 'project-1', { limit: 20, unreadOnly: false });

      expect(list).toHaveBeenCalledWith(USER.id, 'project-1', { limit: 20, unreadOnly: false });
    });

    it('never lists when the caller is not a project member', async () => {
      const authorize = jest.fn().mockRejectedValue(new NotFoundError('Project'));
      const { controller, list } = makeController({ authorize });

      await expect(controller.list(USER, 'project-1', { limit: 20, unreadOnly: false })).rejects.toThrow(NotFoundError);
      expect(list).not.toHaveBeenCalled();
    });

    it('never lists when the caller lacks the capability', async () => {
      const authorize = jest.fn().mockRejectedValue(new ForbiddenError());
      const { controller, list } = makeController({ authorize });

      await expect(controller.list(USER, 'project-1', { limit: 20, unreadOnly: false })).rejects.toThrow(
        ForbiddenError,
      );
      expect(list).not.toHaveBeenCalled();
    });
  });

  describe('unreadCount', () => {
    it("authorizes before counting, and scopes to the caller's own id", async () => {
      const { controller, authorize, unreadCount } = makeController();

      const result = await controller.unreadCount(USER, 'project-1');

      expect(authorize).toHaveBeenCalledWith('project-1', USER.id, Capability.ProjectRead);
      expect(unreadCount).toHaveBeenCalledWith(USER.id, 'project-1');
      expect(result).toEqual({ count: 2 });
    });

    it('never counts when authorization fails', async () => {
      const authorize = jest.fn().mockRejectedValue(new NotFoundError('Project'));
      const { controller, unreadCount } = makeController({ authorize });

      await expect(controller.unreadCount(USER, 'project-1')).rejects.toThrow(NotFoundError);
      expect(unreadCount).not.toHaveBeenCalled();
    });
  });

  describe('markRead', () => {
    it("authorizes before marking read, passing the caller's own id and the notification id from the URL", async () => {
      const { controller, authorize, markRead } = makeController();

      await controller.markRead(USER, 'project-1', 'notif_1');

      expect(authorize).toHaveBeenCalledWith('project-1', USER.id, Capability.ProjectRead);
      expect(markRead).toHaveBeenCalledWith(USER.id, 'project-1', 'notif_1');
    });

    it("propagates a not-found from the service (e.g. another member's notification) without marking anything", async () => {
      const { controller, markRead } = makeController();
      markRead.mockRejectedValue(new NotFoundError('Notification'));

      await expect(controller.markRead(USER, 'project-1', 'notif_someone_elses')).rejects.toThrow(NotFoundError);
    });
  });

  describe('markAllRead', () => {
    it("authorizes before marking all read, scoped to the caller's own id", async () => {
      const { controller, authorize, markAllRead } = makeController();

      await controller.markAllRead(USER, 'project-1');

      expect(authorize).toHaveBeenCalledWith('project-1', USER.id, Capability.ProjectRead);
      expect(markAllRead).toHaveBeenCalledWith(USER.id, 'project-1');
    });

    it('never marks anything read when the caller is not a project member', async () => {
      const authorize = jest.fn().mockRejectedValue(new NotFoundError('Project'));
      const { controller, markAllRead } = makeController({ authorize });

      await expect(controller.markAllRead(USER, 'project-1')).rejects.toThrow(NotFoundError);
      expect(markAllRead).not.toHaveBeenCalled();
    });
  });
});
