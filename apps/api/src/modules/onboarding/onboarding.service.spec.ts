import { PrismaService } from '../../shared/database/prisma.service';
import { OnboardingService } from './onboarding.service';

describe('OnboardingService', () => {
  let service: OnboardingService;
  let prisma: {
    userOnboarding: { findUnique: jest.Mock; upsert: jest.Mock; updateMany: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      userOnboarding: { findUnique: jest.fn(), upsert: jest.fn(), updateMany: jest.fn() },
    };
    service = new OnboardingService(prisma as unknown as PrismaService);
  });

  describe('ensureStarted', () => {
    it('is idempotent: the upsert never overwrites an existing row', async () => {
      await service.ensureStarted('u1');
      expect(prisma.userOnboarding.upsert).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        create: { userId: 'u1' },
        update: {},
      });
    });
  });

  describe('getState', () => {
    it('reads a missing row as "not started" rather than erroring', async () => {
      prisma.userOnboarding.findUnique.mockResolvedValue(null);
      await expect(service.getState('u1')).resolves.toEqual({
        step: 1,
        completed: false,
        completedAt: null,
        useCases: [],
        experienceLevel: null,
        stack: [],
        createdFirstProject: false,
      });
    });

    it('reports completion from the timestamp, never a separate flag', async () => {
      const completedAt = new Date('2026-09-08T10:00:00Z');
      prisma.userOnboarding.findUnique.mockResolvedValue({
        step: 7,
        completedAt,
        useCases: ['saas'],
        experienceLevel: 'experienced',
        stack: ['react'],
        createdFirstProject: true,
      });
      const state = await service.getState('u1');
      expect(state.completed).toBe(true);
      expect(state.completedAt).toBe(completedAt);
    });
  });

  describe('update', () => {
    it('persists only the fields the step actually answered', async () => {
      prisma.userOnboarding.findUnique.mockResolvedValue({
        step: 3,
        completedAt: null,
        useCases: ['saas'],
        experienceLevel: null,
        stack: [],
        createdFirstProject: false,
      });
      await service.update('u1', { step: 3, useCases: ['saas'] });
      expect(prisma.userOnboarding.upsert).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        create: { userId: 'u1', step: 3, useCases: ['saas'] },
        update: { step: 3, useCases: ['saas'] },
      });
    });
  });

  describe('complete', () => {
    it('stamps completion conditionally so a second call keeps the original timestamp', async () => {
      prisma.userOnboarding.findUnique.mockResolvedValue({
        step: 7,
        completedAt: new Date(),
        useCases: [],
        experienceLevel: null,
        stack: [],
        createdFirstProject: true,
      });
      await service.complete('u1');
      expect(prisma.userOnboarding.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', completedAt: null },
        data: { completedAt: expect.any(Date), step: 7 },
      });
    });
  });
});
