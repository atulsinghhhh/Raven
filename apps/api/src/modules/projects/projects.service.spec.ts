import { ProjectStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { ForbiddenError, NotFoundError } from '../../shared/errors/app-error';
import { Capability, ProjectRole } from './project-permissions';
import { ProjectsService } from './projects.service';

describe('ProjectsService', () => {
  let service: ProjectsService;
  let prisma: {
    project: { findUnique: jest.Mock; update: jest.Mock; create: jest.Mock };
    projectMember: { findUnique: jest.Mock };
  };

  const activeProject: { id: string; ownerId: string; status: ProjectStatus } = {
    id: 'p1',
    ownerId: 'owner1',
    status: ProjectStatus.ACTIVE,
  };

  /** A membership row as `authorize` reads it: role plus the joined project. */
  function membership(role: ProjectRole, project = activeProject) {
    return { projectId: project.id, userId: 'u1', role, project };
  }

  beforeEach(() => {
    prisma = {
      project: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
      projectMember: { findUnique: jest.fn() },
    };
    service = new ProjectsService(prisma as unknown as PrismaService);
  });

  describe('authorize', () => {
    it('returns the project and the role that allowed it', async () => {
      prisma.projectMember.findUnique.mockResolvedValue(membership(ProjectRole.ADMIN));

      await expect(service.authorize('p1', 'u1', Capability.KeysManage)).resolves.toEqual({
        project: activeProject,
        role: ProjectRole.ADMIN,
      });
    });

    it('reports a non-member with 404, not 403', async () => {
      // Indistinguishable from "no such project". A 403 would confirm the
      // id is real and belongs to someone, which is what an attacker
      // enumerating ids is trying to find out.
      prisma.projectMember.findUnique.mockResolvedValue(null);

      await expect(service.authorize('p1', 'stranger', Capability.ProjectRead)).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it('reports a member lacking the capability with 403, not 404', async () => {
      // They already know the project exists. Hiding it achieves nothing
      // and sends them hunting for a bug instead of asking for access.
      prisma.projectMember.findUnique.mockResolvedValue(membership(ProjectRole.VIEWER));

      await expect(service.authorize('p1', 'u1', Capability.KeysManage)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });

    it('names the role and the missing capability, so the fix is obvious', async () => {
      prisma.projectMember.findUnique.mockResolvedValue(membership(ProjectRole.VIEWER));

      await expect(service.authorize('p1', 'u1', Capability.KeysManage)).rejects.toThrow(
        /viewer.*keys:manage/,
      );
    });

    it('treats an archived project as gone even for its owner', async () => {
      prisma.projectMember.findUnique.mockResolvedValue(
        membership(ProjectRole.OWNER, { ...activeProject, status: ProjectStatus.ARCHIVED }),
      );

      await expect(service.authorize('p1', 'u1', Capability.ProjectRead)).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it('looks the membership up by the composite key, never by project alone', async () => {
      prisma.projectMember.findUnique.mockResolvedValue(membership(ProjectRole.OWNER));

      await service.authorize('p1', 'u1', Capability.ProjectRead);

      expect(prisma.projectMember.findUnique).toHaveBeenCalledWith({
        where: { projectId_userId: { projectId: 'p1', userId: 'u1' } },
        include: { project: true },
      });
    });
  });

  describe('create', () => {
    it('writes the creator’s OWNER membership with the project', async () => {
      prisma.project.create.mockResolvedValue(activeProject);

      await service.create('owner1', { name: 'demo' });

      // In one statement on purpose: a project whose owner membership
      // failed to write would be unreachable by anyone.
      expect(prisma.project.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          ownerId: 'owner1',
          members: { create: { userId: 'owner1', role: ProjectRole.OWNER } },
        }),
      });
    });
  });

  describe('findOneById', () => {
    it('throws NotFoundError when the project does not exist', async () => {
      prisma.project.findUnique.mockResolvedValue(null);

      await expect(service.findOneById('p1')).rejects.toBeInstanceOf(NotFoundError);
    });

    it('returns the project with no membership check (safe only behind an already-scoped caller, e.g. an API key)', async () => {
      const project = { id: 'p1', ownerId: 'owner-someone-else', status: ProjectStatus.ACTIVE };
      prisma.project.findUnique.mockResolvedValue(project);

      await expect(service.findOneById('p1')).resolves.toEqual(project);
    });
  });

  describe('archive', () => {
    it('soft-deletes by setting status to ARCHIVED instead of removing the row', async () => {
      prisma.projectMember.findUnique.mockResolvedValue(membership(ProjectRole.OWNER));

      await service.archive('p1', 'u1');

      expect(prisma.project.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { status: ProjectStatus.ARCHIVED },
      });
    });

    it('refuses an admin, because deleting takes every key and room with it', async () => {
      prisma.projectMember.findUnique.mockResolvedValue(membership(ProjectRole.ADMIN));

      await expect(service.archive('p1', 'u1')).rejects.toBeInstanceOf(ForbiddenError);
      expect(prisma.project.update).not.toHaveBeenCalled();
    });

    it('refuses someone who is not a member at all', async () => {
      prisma.projectMember.findUnique.mockResolvedValue(null);

      await expect(service.archive('p1', 'stranger')).rejects.toBeInstanceOf(NotFoundError);
      expect(prisma.project.update).not.toHaveBeenCalled();
    });
  });
});
