import { PrismaService } from '../../shared/database/prisma.service';
import { EmailType } from '../email/email.constants';
import { EmailService } from '../email/email.service';
import { ConflictError, ForbiddenError, NotFoundError, ValidationFailedError } from '../../shared/errors/app-error';
import { ProjectMembersService } from './project-members.service';
import { Capability, ProjectRole } from './project-permissions';
import { ProjectsService } from './projects.service';

describe('ProjectMembersService', () => {
  let service: ProjectMembersService;
  let prisma: {
    projectMember: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      count: jest.Mock;
    };
    user: { findUnique: jest.Mock };
    project: { findUnique: jest.Mock };
  };
  let projects: { authorize: jest.Mock };
  let emailService: { send: jest.Mock; brand: unknown; docsUrl: string };

  /** Makes `authorize` succeed and report the actor's role. */
  function actingAs(role: ProjectRole) {
    projects.authorize.mockResolvedValue({ project: { id: 'p1' }, role });
  }

  beforeEach(() => {
    prisma = {
      projectMember: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        create: jest.fn().mockResolvedValue({ createdAt: new Date(), invitedById: 'actor' }),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn().mockResolvedValue(1),
      },
      user: { findUnique: jest.fn() },
      project: { findUnique: jest.fn().mockResolvedValue({ name: 'Aurora' }) },
    };
    projects = { authorize: jest.fn() };
    // A fake: no test may reach a real mail provider, and CI has no key.
    emailService = {
      send: jest.fn().mockResolvedValue({ status: 'sent', messageId: 'msg_1' }),
      brand: { appUrl: 'https://app.ravenstack.online', supportEmail: 'support@mail.ravenstack.online' },
      docsUrl: 'https://docs.ravenstack.online',
    };
    service = new ProjectMembersService(
      prisma as unknown as PrismaService,
      projects as unknown as ProjectsService,
      emailService as unknown as EmailService,
    );
  });

  describe('add', () => {
    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u2', email: 'new@example.com', name: 'New' });
      prisma.projectMember.findUnique.mockResolvedValue(null);
      prisma.projectMember.create.mockResolvedValue({
        role: ProjectRole.DEVELOPER,
        invitedById: 'actor',
        createdAt: new Date(),
      });
    });

    it('checks members:manage before anything else', async () => {
      actingAs(ProjectRole.ADMIN);

      await service.add('p1', 'actor', { email: 'new@example.com', role: ProjectRole.DEVELOPER });

      expect(projects.authorize).toHaveBeenCalledWith('p1', 'actor', Capability.MembersManage);
    });

    it('refuses an admin trying to create another owner', async () => {
      // The escalation this prevents: admin adds themselves-as-owner, then
      // demotes the real owner.
      actingAs(ProjectRole.ADMIN);

      await expect(
        service.add('p1', 'actor', { email: 'new@example.com', role: ProjectRole.OWNER }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(prisma.projectMember.create).not.toHaveBeenCalled();
    });

    it('lets an owner create another owner', async () => {
      actingAs(ProjectRole.OWNER);

      await expect(
        service.add('p1', 'actor', { email: 'new@example.com', role: ProjectRole.OWNER }),
      ).resolves.toBeDefined();
    });

    it('says plainly when there is no account for that address', async () => {
      // Better than a pending row that never becomes anything, or a
      // silent success that leaves the inviter waiting.
      actingAs(ProjectRole.OWNER);
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.add('p1', 'actor', { email: 'nobody@example.com', role: ProjectRole.VIEWER }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('matches the address case-insensitively', async () => {
      actingAs(ProjectRole.OWNER);

      await service.add('p1', 'actor', { email: 'New@Example.COM', role: ProjectRole.VIEWER });

      expect(prisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { email: 'new@example.com' } }),
      );
    });

    it('refuses to add someone twice', async () => {
      actingAs(ProjectRole.OWNER);
      prisma.projectMember.findUnique.mockResolvedValue({ role: ProjectRole.VIEWER });

      await expect(
        service.add('p1', 'actor', { email: 'new@example.com', role: ProjectRole.ADMIN }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('records who did the adding', async () => {
      actingAs(ProjectRole.OWNER);

      await service.add('p1', 'actor', { email: 'new@example.com', role: ProjectRole.VIEWER });

      expect(prisma.projectMember.create).toHaveBeenCalledWith({
        data: { projectId: 'p1', userId: 'u2', role: ProjectRole.VIEWER, invitedById: 'actor' },
      });
    });
  });

  describe('the last owner', () => {
    beforeEach(() => {
      actingAs(ProjectRole.OWNER);
      prisma.projectMember.findUnique.mockResolvedValue({
        userId: 'owner1',
        role: ProjectRole.OWNER,
      });
    });

    it('cannot be demoted', async () => {
      // A project with no owner cannot be administered by anyone: not
      // even to appoint a new owner. It would be permanently stuck.
      prisma.projectMember.count.mockResolvedValue(0);

      await expect(service.updateRole('p1', 'owner1', 'owner1', ProjectRole.ADMIN)).rejects.toBeInstanceOf(
        ValidationFailedError,
      );
      expect(prisma.projectMember.update).not.toHaveBeenCalled();
    });

    it('cannot be removed', async () => {
      prisma.projectMember.count.mockResolvedValue(0);

      await expect(service.remove('p1', 'owner1', 'owner1')).rejects.toBeInstanceOf(ValidationFailedError);
      expect(prisma.projectMember.delete).not.toHaveBeenCalled();
    });

    it('counts other owners rather than trusting a stale members list', async () => {
      prisma.projectMember.count.mockResolvedValue(0);

      await service.remove('p1', 'owner1', 'owner1').catch(() => undefined);

      expect(prisma.projectMember.count).toHaveBeenCalledWith({
        where: { projectId: 'p1', role: ProjectRole.OWNER, userId: { not: 'owner1' } },
      });
    });

    it('is demotable once a second owner exists', async () => {
      prisma.projectMember.count.mockResolvedValue(1);
      prisma.projectMember.update.mockResolvedValue({
        userId: 'owner1',
        role: ProjectRole.ADMIN,
        invitedById: null,
        createdAt: new Date(),
        user: { email: 'a@b.c', name: null },
      });

      await expect(service.updateRole('p1', 'owner1', 'owner1', ProjectRole.ADMIN)).resolves.toMatchObject({
        role: ProjectRole.ADMIN,
      });
    });
  });

  describe('updateRole', () => {
    it('stops an admin demoting an owner', async () => {
      actingAs(ProjectRole.ADMIN);
      prisma.projectMember.findUnique.mockResolvedValue({
        userId: 'owner1',
        role: ProjectRole.OWNER,
      });

      await expect(service.updateRole('p1', 'admin1', 'owner1', ProjectRole.VIEWER)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });

    it('refuses to change someone who is not a member', async () => {
      actingAs(ProjectRole.OWNER);
      prisma.projectMember.findUnique.mockResolvedValue(null);

      await expect(service.updateRole('p1', 'owner1', 'stranger', ProjectRole.VIEWER)).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });
  });

  describe('list', () => {
    it('sends each member’s capabilities so a dashboard need not re-derive them', async () => {
      actingAs(ProjectRole.VIEWER);
      prisma.projectMember.findMany.mockResolvedValue([
        {
          userId: 'u1',
          role: ProjectRole.VIEWER,
          invitedById: null,
          createdAt: new Date(),
          user: { email: 'v@example.com', name: 'V' },
        },
      ]);

      const [member] = await service.list('p1', 'u1');

      // Two copies of this table would drift, and the front-end copy is
      // the one that would be wrong.
      expect(member.capabilities).toContain(Capability.ProjectRead);
      expect(member.capabilities).not.toContain(Capability.KeysManage);
    });

    it('requires only members:read, so a viewer can see who else has access', async () => {
      actingAs(ProjectRole.VIEWER);

      await service.list('p1', 'u1');

      expect(projects.authorize).toHaveBeenCalledWith('p1', 'u1', Capability.MembersRead);
    });
  });

  describe('add — notification email', () => {
    beforeEach(() => {
      actingAs(ProjectRole.OWNER);
      prisma.user.findUnique.mockResolvedValue({ id: 'u2', email: 'new@example.com', name: 'New' });
      prisma.projectMember.findUnique.mockResolvedValue(null);
      prisma.projectMember.create.mockResolvedValue({
        role: ProjectRole.DEVELOPER,
        invitedById: 'actor',
        createdAt: new Date(),
      });
    });

    it('tells the new member, naming the project and their role', async () => {
      await service.add('p1', 'actor', { email: 'new@example.com', role: ProjectRole.DEVELOPER });

      const [payload] = emailService.send.mock.calls[0];
      expect(payload.to).toBe('new@example.com');
      expect(payload.type).toBe(EmailType.ProjectMemberAdded);
      expect(payload.email.subject).toContain('Aurora');
      expect(payload.email.text).toContain('developer');
    });

    it('adds the member even when the email cannot be sent — access is already granted', async () => {
      emailService.send.mockRejectedValue(new Error('mail provider down'));

      const member = await service.add('p1', 'actor', {
        email: 'new@example.com',
        role: ProjectRole.DEVELOPER,
      });

      expect(member.userId).toBe('u2');
    });
  });
});
