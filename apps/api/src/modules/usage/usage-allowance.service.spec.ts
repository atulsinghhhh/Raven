import { ConfigService } from '@nestjs/config';
import { UsageAllowance, UsageAllowanceSource, UsageProduct } from '../../generated/prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotFoundError, UsageLimitExceededError } from '../../shared/errors/app-error';
import { UsageAllowanceService } from './usage-allowance.service';
import { minutesToSeconds } from './usage.constants';

const FREE_TIER_MINUTES = 20_000;

function makeAllowance(overrides: Partial<UsageAllowance> = {}): UsageAllowance {
  return {
    id: 'ua_1',
    userId: 'u_1',
    product: UsageProduct.RTC,
    source: UsageAllowanceSource.FREE_TIER,
    includedMinutes: FREE_TIER_MINUTES,
    consumedSeconds: 0,
    includedCount: null,
    consumedCount: 0,
    exhaustedAt: null,
    grantedAt: new Date('2026-01-01T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('UsageAllowanceService', () => {
  let service: UsageAllowanceService;
  let prisma: {
    usageAllowance: { upsert: jest.Mock };
    usageSession: { count: jest.Mock; findMany: jest.Mock; groupBy: jest.Mock };
    project: { findUnique: jest.Mock; findMany: jest.Mock };
  };
  let config: Record<string, unknown>;

  beforeEach(() => {
    config = {
      'usage.freeTierRtcMinutes': FREE_TIER_MINUTES,
      'usage.enforceLimit': true,
    };
    prisma = {
      usageAllowance: { upsert: jest.fn().mockResolvedValue(makeAllowance()) },
      usageSession: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      project: {
        findUnique: jest.fn().mockResolvedValue({ ownerId: 'u_1' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const configService = { get: jest.fn((key: string) => config[key]) } as unknown as ConfigService;
    service = new UsageAllowanceService(prisma as unknown as PrismaService, configService);
  });

  describe('allocation', () => {
    it('grants a new developer the configured free-tier minutes', async () => {
      await service.ensureProvisioned('u_1');

      expect(prisma.usageAllowance.upsert).toHaveBeenCalledWith({
        where: { userId_product: { userId: 'u_1', product: UsageProduct.RTC } },
        create: {
          userId: 'u_1',
          product: UsageProduct.RTC,
          source: UsageAllowanceSource.FREE_TIER,
          includedMinutes: FREE_TIER_MINUTES,
          includedCount: null,
        },
        update: {},
      });
    });

    it('snapshots the granted minutes rather than reading a constant at display time', async () => {
      // The dashboard must show what *this* account was granted. An
      // account granted 20,000 keeps 20,000 after the default changes.
      const summary = await service.getSummary('u_1');
      expect(summary.includedMinutes).toBe(FREE_TIER_MINUTES);

      config['usage.freeTierRtcMinutes'] = 500;
      prisma.usageAllowance.upsert.mockResolvedValue(makeAllowance({ includedMinutes: FREE_TIER_MINUTES }));

      expect((await service.getSummary('u_1')).includedMinutes).toBe(FREE_TIER_MINUTES);
    });

    it('provisions idempotently, with an empty update so a spent allowance is never reset', async () => {
      await service.ensureProvisioned('u_1');
      await service.ensureProvisioned('u_1');

      for (const call of prisma.usageAllowance.upsert.mock.calls) {
        expect(call[0].update).toEqual({});
      }
    });

    it('resolves a project to its owner, so a project spends the owner allowance', async () => {
      prisma.project.findUnique.mockResolvedValue({ ownerId: 'owner_9' });

      await service.ensureProvisionedForProject('p_1');

      expect(prisma.usageAllowance.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId_product: { userId: 'owner_9', product: UsageProduct.RTC } } }),
      );
    });

    it('refuses to provision against a project that does not exist', async () => {
      prisma.project.findUnique.mockResolvedValue(null);

      await expect(service.ensureProvisionedForProject('nope')).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('summary', () => {
    it('derives used, remaining and percentage from the consumed counter', async () => {
      // 5,000 minutes of a 20,000-minute allowance.
      prisma.usageAllowance.upsert.mockResolvedValue(makeAllowance({ consumedSeconds: minutesToSeconds(5_000) }));

      const summary = await service.getSummary('u_1');

      expect(summary.usedMinutes).toBe(5_000);
      expect(summary.remainingMinutes).toBe(15_000);
      expect(summary.usedPercent).toBe(25);
      expect(summary.exhausted).toBe(false);
    });

    it('floors partial minutes rather than rounding them up', async () => {
      // 90 seconds is one minute used, not two: the developer is not
      // charged for a minute they have not had.
      prisma.usageAllowance.upsert.mockResolvedValue(makeAllowance({ consumedSeconds: 90 }));

      const summary = await service.getSummary('u_1');

      expect(summary.usedMinutes).toBe(1);
      expect(summary.usedSeconds).toBe(90);
    });

    it('never reports more than 100% or fewer than zero minutes left', async () => {
      // A session can overrun its last seconds before the meter catches
      // up; the UI must not render "103% of a hard limit".
      prisma.usageAllowance.upsert.mockResolvedValue(makeAllowance({ consumedSeconds: minutesToSeconds(20_600) }));

      const summary = await service.getSummary('u_1');

      expect(summary.usedPercent).toBe(100);
      expect(summary.remainingMinutes).toBe(0);
      expect(summary.exhausted).toBe(true);
    });

    it('reports the live session count alongside the totals', async () => {
      prisma.usageSession.count.mockResolvedValue(3);

      expect((await service.getSummary('u_1')).liveSessions).toBe(3);
      expect(prisma.usageSession.count).toHaveBeenCalledWith({
        where: { allowanceId: 'ua_1', endedAt: null },
      });
    });

    it('surfaces exhaustedAt unchanged, so an exhausted allowance never reads as fresh', async () => {
      const exhaustedAt = new Date('2026-06-01T10:00:00.000Z');
      prisma.usageAllowance.upsert.mockResolvedValue(
        makeAllowance({ consumedSeconds: minutesToSeconds(FREE_TIER_MINUTES), exhaustedAt }),
      );

      const summary = await service.getSummary('u_1');

      expect(summary.exhausted).toBe(true);
      expect(summary.exhaustedAt).toEqual(exhaustedAt);
    });
  });

  describe('exhaustion and enforcement', () => {
    it('treats the allowance as exhausted exactly at the granted minute', async () => {
      const exactly = makeAllowance({ consumedSeconds: minutesToSeconds(FREE_TIER_MINUTES) });
      const oneSecondShort = makeAllowance({ consumedSeconds: minutesToSeconds(FREE_TIER_MINUTES) - 1 });

      expect(service.isExhausted(exactly)).toBe(true);
      expect(service.isExhausted(oneSecondShort)).toBe(false);
    });

    it('blocks a project whose owner has spent everything', async () => {
      prisma.usageAllowance.upsert.mockResolvedValue(
        makeAllowance({ consumedSeconds: minutesToSeconds(FREE_TIER_MINUTES) }),
      );

      const result = await service.checkProject('p_1');

      expect(result).toMatchObject({ exhausted: true, blocked: true });
      await expect(service.assertProjectWithinAllowance('p_1')).rejects.toBeInstanceOf(UsageLimitExceededError);
    });

    it('carries the figures on the error, so a caller needs no second request', async () => {
      prisma.usageAllowance.upsert.mockResolvedValue(
        makeAllowance({ consumedSeconds: minutesToSeconds(FREE_TIER_MINUTES) }),
      );

      await expect(service.assertProjectWithinAllowance('p_1')).rejects.toMatchObject({
        code: 'RAVEN_USAGE_LIMIT_EXCEEDED',
        response: expect.objectContaining({
          includedMinutes: FREE_TIER_MINUTES,
          usedMinutes: FREE_TIER_MINUTES,
          remainingMinutes: 0,
        }),
      });
    });

    it('admits a project with minutes left', async () => {
      prisma.usageAllowance.upsert.mockResolvedValue(makeAllowance({ consumedSeconds: 60 }));

      expect(await service.checkProject('p_1')).toMatchObject({ exhausted: false, blocked: false });
      await expect(service.assertProjectWithinAllowance('p_1')).resolves.toBeDefined();
    });

    it('still reports exhaustion when enforcement is off, but does not block', async () => {
      // A self-hoster running their own SFU caps nothing, and still wants
      // the dashboard to be honest about the number.
      config['usage.enforceLimit'] = false;
      prisma.usageAllowance.upsert.mockResolvedValue(
        makeAllowance({ consumedSeconds: minutesToSeconds(FREE_TIER_MINUTES) }),
      );

      expect(await service.checkProject('p_1')).toMatchObject({ exhausted: true, blocked: false });
      await expect(service.assertProjectWithinAllowance('p_1')).resolves.toBeDefined();
      expect((await service.getSummary('u_1')).enforced).toBe(false);
    });
  });

  describe('history', () => {
    it('lists sessions newest first and marks the live ones', async () => {
      prisma.usageSession.findMany.mockResolvedValue([
        {
          id: 's_1',
          projectId: 'p_1',
          project: { name: 'Demo' },
          environment: 'PRODUCTION',
          roomName: 'lobby',
          participantIdentity: 'alice',
          kind: 'RTC_PARTICIPANT_MINUTES',
          startedAt: new Date('2026-06-01T10:00:00.000Z'),
          endedAt: null,
          meteredSeconds: 150,
          closeReason: null,
        },
      ]);

      const history = await service.listHistory('u_1');

      expect(prisma.usageSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { startedAt: 'desc' } }),
      );
      expect(history[0]).toMatchObject({
        projectName: 'Demo',
        meteredSeconds: 150,
        meteredMinutes: 2,
        live: true,
      });
    });

    it('narrows to one project when asked', async () => {
      await service.listHistory('u_1', { projectId: 'p_9', limit: 10 });

      expect(prisma.usageSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u_1', product: UsageProduct.RTC, projectId: 'p_9' },
          take: 10,
        }),
      );
    });
  });

  describe('daily rollup', () => {
    it('returns one bucket per requested day, zeroes included', async () => {
      const daily = await service.getDailyUsage('u_1', { days: 7 });

      expect(daily).toHaveLength(7);
      expect(daily.every((bucket) => bucket.seconds === 0)).toBe(true);
      // Oldest first, and the last bucket is today.
      expect(daily[6].date).toBe(new Date().toISOString().slice(0, 10));
    });

    it('sums a day sessions into its bucket', async () => {
      const today = new Date();
      prisma.usageSession.findMany.mockResolvedValue([
        { startedAt: today, meteredSeconds: 100 },
        { startedAt: today, meteredSeconds: 80 },
      ]);

      const daily = await service.getDailyUsage('u_1', { days: 3 });
      const todayBucket = daily[2];

      expect(todayBucket.seconds).toBe(180);
      expect(todayBucket.minutes).toBe(3);
      expect(todayBucket.sessions).toBe(2);
    });

    it('ignores a session dated outside the window instead of inventing a bucket', async () => {
      prisma.usageSession.findMany.mockResolvedValue([
        { startedAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), meteredSeconds: 999 },
      ]);

      const daily = await service.getDailyUsage('u_1', { days: 3 });

      expect(daily.reduce((sum, bucket) => sum + bucket.seconds, 0)).toBe(0);
    });
  });

  describe('per-project breakdown', () => {
    it('groups by project, resolves names, and sorts by consumption', async () => {
      prisma.usageSession.groupBy.mockResolvedValue([
        { projectId: 'p_small', _sum: { meteredSeconds: 60 }, _count: { _all: 1 } },
        { projectId: 'p_big', _sum: { meteredSeconds: 600 }, _count: { _all: 4 } },
      ]);
      prisma.project.findMany.mockResolvedValue([
        { id: 'p_small', name: 'Small' },
        { id: 'p_big', name: 'Big' },
      ]);

      const rows = await service.getUsageByProject('u_1');

      expect(rows.map((row) => row.projectId)).toEqual(['p_big', 'p_small']);
      expect(rows[0]).toMatchObject({ projectName: 'Big', minutes: 10, sessions: 4 });
    });

    it('skips the name lookup entirely when there is no usage', async () => {
      expect(await service.getUsageByProject('u_1')).toEqual([]);
      expect(prisma.project.findMany).not.toHaveBeenCalled();
    });
  });
});
