import { Logger } from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma.service';
import { Environment } from '../../shared/environment/environment.constants';
import { AuditAction, AuditResource } from './audit.constants';
import { AuditService } from './audit.service';

describe('AuditService', () => {
  let service: AuditService;
  let prisma: { auditLog: { create: jest.Mock; findMany: jest.Mock } };

  const entry = {
    projectId: 'p1',
    actor: { id: 'u1', email: 'dev@example.com' },
    action: AuditAction.ApiKeyRevoked,
    resourceType: AuditResource.ApiKey,
    resourceId: 'rvk_prod_abc',
  };

  beforeEach(() => {
    prisma = { auditLog: { create: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) } };
    service = new AuditService(prisma as unknown as PrismaService);
  });

  describe('record', () => {
    it('writes who did what to which resource', async () => {
      await service.record(entry);

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          projectId: 'p1',
          actorId: 'u1',
          actorEmail: 'dev@example.com',
          action: 'api_key.revoked',
          resourceType: 'api_key',
          resourceId: 'rvk_prod_abc',
        }),
      });
    });

    it('denormalises the actor email so the record survives the account', async () => {
      // An audit trail matters most precisely when the person who acted is
      // gone. A dangling foreign key would leave "someone did this".
      await service.record(entry);

      const { data } = prisma.auditLog.create.mock.calls[0][0];
      expect(data.actorEmail).toBe('dev@example.com');
    });

    it('carries the request id through, so an entry ties back to one request', async () => {
      await service.record({
        ...entry,
        context: { requestId: 'req_abc', ipAddress: '203.0.113.7', userAgent: 'raven-cli/0.1.0' },
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          requestId: 'req_abc',
          ipAddress: '203.0.113.7',
          userAgent: 'raven-cli/0.1.0',
        }),
      });
    });

    it('gives every entry a prefixed public id', async () => {
      await service.record(entry);

      const { data } = prisma.auditLog.create.mock.calls[0][0];
      expect(data.publicId).toMatch(/^aud_/);
    });

    it('records the environment when the action belongs to one', async () => {
      await service.record({ ...entry, environment: Environment.PRODUCTION });

      const { data } = prisma.auditLog.create.mock.calls[0][0];
      expect(data.environment).toBe(Environment.PRODUCTION);
    });

    it('does not throw when the write fails', async () => {
      // The mutation has already committed by the time we get here.
      // Reporting failure would tell the caller their key was not created
      // when it was, and a retry would create a second one. A missing
      // audit row is a gap; a duplicated production key is an incident.
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      prisma.auditLog.create.mockRejectedValue(new Error('disk full'));

      await expect(service.record(entry)).resolves.toBeUndefined();
    });

    it('logs the failure at error level rather than swallowing it silently', async () => {
      // An audit trail that quietly stops recording is worth less than
      // none, because it is trusted.
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      prisma.auditLog.create.mockRejectedValue(new Error('disk full'));

      await service.record(entry);

      expect(error).toHaveBeenCalledWith(expect.stringContaining('api_key.revoked'));
    });
  });

  describe('list', () => {
    it('returns newest first', async () => {
      await service.list('p1');

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
      );
    });

    it('defaults to 50 and refuses to be talked past 200', async () => {
      await service.list('p1', { limit: 10_000 });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 200 }));
    });

    it('treats a nonsensical limit as the minimum rather than erroring', async () => {
      await service.list('p1', { limit: 0 });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 1 }));
    });

    it('filters by action, actor and resource when asked', async () => {
      await service.list('p1', {
        action: 'member.removed',
        actorId: 'u9',
        resourceId: 'rvk_dev_x',
      });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            projectId: 'p1',
            action: 'member.removed',
            actorId: 'u9',
            resourceId: 'rvk_dev_x',
          },
        }),
      );
    });

    it('never scopes wider than one project', async () => {
      await service.list('p1', { actorId: 'u9' });

      const { where } = prisma.auditLog.findMany.mock.calls[0][0];
      expect(where.projectId).toBe('p1');
    });
  });

  describe('immutability', () => {
    it('exposes no way to change or remove an entry', () => {
      // An audit log an administrator can edit is not an audit log. There
      // is no update or delete here, and no endpoint that could reach one.
      const methods = Object.getOwnPropertyNames(AuditService.prototype);
      expect(methods).not.toContain('update');
      expect(methods).not.toContain('delete');
      expect(methods).not.toContain('remove');
    });
  });
});
