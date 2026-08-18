import { ErrorCategory } from '../../generated/prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotFoundError } from '../../shared/errors/app-error';
import { ErrorsService } from './errors.service';

describe('ErrorsService', () => {
  let service: ErrorsService;
  let prisma: { errorEvent: { findMany: jest.Mock; findUnique: jest.Mock } };

  beforeEach(() => {
    prisma = { errorEvent: { findMany: jest.fn(), findUnique: jest.fn() } };
    service = new ErrorsService(prisma as unknown as PrismaService);
  });

  describe('listForProject', () => {
    it('replaces the internal connection database id with the public conn_... ID', async () => {
      prisma.errorEvent.findMany.mockResolvedValue([
        {
          id: 'uuid-1',
          publicId: 'err_abc',
          projectId: 'project-1',
          connectionId: 'internal-connection-uuid',
          category: ErrorCategory.TOKEN_ERROR,
          message: 'expired',
          connection: { id: 'internal-connection-uuid', publicId: 'conn_xyz' },
        },
      ]);

      const [result] = await service.listForProject('project-1', { limit: 50 });

      expect(result.connectionId).toBe('conn_xyz');
      expect(result).not.toHaveProperty('connection');
    });

    it('reports connectionId: null when the connection no longer exists', async () => {
      prisma.errorEvent.findMany.mockResolvedValue([
        { id: 'uuid-1', publicId: 'err_abc', projectId: 'project-1', connectionId: null, connection: null },
      ]);

      const [result] = await service.listForProject('project-1', { limit: 50 });

      expect(result.connectionId).toBeNull();
    });
  });

  describe('getDetail', () => {
    it('throws NotFoundError for an error belonging to a different project', async () => {
      prisma.errorEvent.findUnique.mockResolvedValue({ publicId: 'err_abc', projectId: 'other-project', connection: null });

      await expect(service.getDetail('project-1', 'err_abc')).rejects.toBeInstanceOf(NotFoundError);
    });

    it('returns the public connectionId alongside the full nested connection object', async () => {
      const connection = { id: 'internal-uuid', publicId: 'conn_xyz', roomName: 'demo' };
      prisma.errorEvent.findUnique.mockResolvedValue({
        publicId: 'err_abc',
        projectId: 'project-1',
        connectionId: 'internal-uuid',
        connection,
      });

      const result = await service.getDetail('project-1', 'err_abc');

      expect(result.connectionId).toBe('conn_xyz');
      expect(result.connection).toBe(connection);
    });
  });
});
