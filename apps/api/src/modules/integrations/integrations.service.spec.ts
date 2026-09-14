import { ApiKeyStatus, Project, UsageProduct } from '../../generated/prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { DiagnosticsService } from '../observability/diagnostics.service';
import { ActivityEventsService } from '../super-admin/activity-events.service';
import { IntegrationsService, parseProductParam } from './integrations.service';

describe('IntegrationsService', () => {
  let service: IntegrationsService;
  let prisma: {
    apiKey: { count: jest.Mock };
    projectIntegration: { findMany: jest.Mock; upsert: jest.Mock; updateMany: jest.Mock };
  };
  let diagnostics: { getDiagnostics: jest.Mock };
  let activityEvents: { record: jest.Mock };

  const project = { id: 'p1', ownerId: 'u1' } as Project;

  beforeEach(() => {
    prisma = {
      apiKey: { count: jest.fn() },
      projectIntegration: { findMany: jest.fn(), upsert: jest.fn(), updateMany: jest.fn().mockResolvedValue({}) },
    };
    diagnostics = { getDiagnostics: jest.fn() };
    activityEvents = { record: jest.fn().mockResolvedValue(undefined) };
    service = new IntegrationsService(
      prisma as unknown as PrismaService,
      diagnostics as unknown as DiagnosticsService,
      activityEvents as unknown as ActivityEventsService,
    );
  });

  describe('parseProductParam', () => {
    it('maps the wizard-facing kebab-case id to the Prisma enum', () => {
      expect(parseProductParam('rtc')).toBe(UsageProduct.RTC);
      expect(parseProductParam('chat')).toBe(UsageProduct.CHAT);
      expect(parseProductParam('live-streaming')).toBe(UsageProduct.LIVE_STREAMING);
    });

    it('rejects anything else rather than guessing', () => {
      expect(() => parseProductParam('python')).toThrow();
    });
  });

  describe('verify', () => {
    it('fails on the API key check when the project has no active key', async () => {
      prisma.apiKey.count.mockResolvedValue(0);
      diagnostics.getDiagnostics.mockResolvedValue({
        dependencies: { signaling: 'up', sfu: 'up', turn: 'up' },
      });

      const result = await service.verify(project, 'u1', UsageProduct.RTC);

      expect(result.success).toBe(false);
      expect(result.checks.find((c) => c.id === 'apiKey')).toMatchObject({ status: 'fail' });
    });

    it('passes every RTC check when a key is active and the media plane is up', async () => {
      prisma.apiKey.count.mockResolvedValue(1);
      diagnostics.getDiagnostics.mockResolvedValue({
        dependencies: { signaling: 'up', sfu: 'up', turn: 'up' },
      });

      const result = await service.verify(project, 'u1', UsageProduct.RTC);

      expect(result.success).toBe(true);
      expect(result.checks.map((c) => c.id)).toEqual(['apiKey', 'sfu', 'turn']);
      expect(prisma.projectIntegration.updateMany).toHaveBeenCalledWith({
        where: { projectId: 'p1', product: UsageProduct.RTC },
        data: { lastVerifiedAt: expect.any(Date), lastVerifiedSuccess: true },
      });
    });

    it('fails RTC when the fleet is degraded, with a specific detail', async () => {
      prisma.apiKey.count.mockResolvedValue(1);
      diagnostics.getDiagnostics.mockResolvedValue({
        dependencies: { signaling: 'up', sfu: 'down', turn: 'up' },
      });

      const result = await service.verify(project, 'u1', UsageProduct.RTC);

      expect(result.success).toBe(false);
      const sfu = result.checks.find((c) => c.id === 'sfu');
      expect(sfu).toMatchObject({ status: 'fail' });
      expect(sfu?.detail).toMatch(/no healthy/i);
    });

    it('checks the chat gateway instead of the media plane for CHAT', async () => {
      prisma.apiKey.count.mockResolvedValue(1);
      diagnostics.getDiagnostics.mockResolvedValue({
        dependencies: { signaling: 'up', sfu: 'down', turn: 'down' },
      });

      const result = await service.verify(project, 'u1', UsageProduct.CHAT);

      expect(result.success).toBe(true);
      expect(result.checks.map((c) => c.id)).toEqual(['apiKey', 'signaling']);
    });

    it('records API_KEY status changes as activity events without throwing on a logging failure', async () => {
      prisma.apiKey.count.mockResolvedValue(1);
      diagnostics.getDiagnostics.mockResolvedValue({
        dependencies: { signaling: 'up', sfu: 'up', turn: 'up' },
      });
      activityEvents.record.mockRejectedValue(new Error('unreachable'));

      await expect(service.verify(project, 'u1', UsageProduct.RTC)).resolves.toMatchObject({ success: true });
    });
  });
});
