import { ProjectStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotFoundError } from '../../shared/errors/app-error';
import { ProjectsService } from './projects.service';

describe('ProjectsService', () => {
  let service: ProjectsService;
  let prisma: {
    project: {
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      project: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    service = new ProjectsService(prisma as unknown as PrismaService);
  });

  describe('findOneForOwner', () => {
    it('throws NotFoundError when the project does not exist', async () => {
      prisma.project.findUnique.mockResolvedValue(null);

      await expect(service.findOneForOwner('p1', 'owner1')).rejects.toBeInstanceOf(NotFoundError);
    });

    it('throws the same NotFoundError when the project belongs to someone else', async () => {
      // Must stay indistinguishable from "doesn't exist" — a different
      // error here would leak that this project ID is real.
      prisma.project.findUnique.mockResolvedValue({ id: 'p1', ownerId: 'owner2' });

      await expect(service.findOneForOwner('p1', 'owner1')).rejects.toBeInstanceOf(NotFoundError);
    });

    it('returns the project when it belongs to the requesting owner', async () => {
      const project = { id: 'p1', ownerId: 'owner1', status: ProjectStatus.ACTIVE };
      prisma.project.findUnique.mockResolvedValue(project);

      await expect(service.findOneForOwner('p1', 'owner1')).resolves.toEqual(project);
    });
  });

  describe('findOneById', () => {
    it('throws NotFoundError when the project does not exist', async () => {
      prisma.project.findUnique.mockResolvedValue(null);

      await expect(service.findOneById('p1')).rejects.toBeInstanceOf(NotFoundError);
    });

    it('returns the project with no ownership check (safe only behind an already-scoped caller, e.g. an API key)', async () => {
      const project = { id: 'p1', ownerId: 'owner-someone-else', status: ProjectStatus.ACTIVE };
      prisma.project.findUnique.mockResolvedValue(project);

      await expect(service.findOneById('p1')).resolves.toEqual(project);
    });
  });

  describe('archive', () => {
    it('soft-deletes by setting status to ARCHIVED instead of removing the row', async () => {
      prisma.project.findUnique.mockResolvedValue({ id: 'p1', ownerId: 'owner1' });

      await service.archive('p1', 'owner1');

      expect(prisma.project.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { status: ProjectStatus.ARCHIVED },
      });
    });

    it('refuses to archive a project owned by someone else', async () => {
      prisma.project.findUnique.mockResolvedValue({ id: 'p1', ownerId: 'owner2' });

      await expect(service.archive('p1', 'owner1')).rejects.toBeInstanceOf(NotFoundError);
      expect(prisma.project.update).not.toHaveBeenCalled();
    });
  });
});
