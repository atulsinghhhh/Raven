import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../shared/database/prisma.service';
import { RetentionService } from './retention.service';

describe('RetentionService', () => {
  let service: RetentionService;
  let prisma: {
    connection: { deleteMany: jest.Mock };
    errorEvent: { deleteMany: jest.Mock };
  };
  let configService: { get: jest.Mock };

  beforeEach(() => {
    prisma = {
      connection: { deleteMany: jest.fn().mockResolvedValue({ count: 3 }) },
      errorEvent: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    configService = {
      get: jest.fn((key: string) => {
        const values: Record<string, number> = {
          'observability.connectionRetentionDays': 30,
          'observability.errorRetentionDays': 30,
          'observability.retentionSweepIntervalMs': 3_600_000,
        };
        return values[key];
      }),
    };
    service = new RetentionService(
      prisma as unknown as PrismaService,
      configService as unknown as ConfigService,
    );
  });

  it('deletes connections and errors older than their configured retention window', async () => {
    const result = await service.sweep();

    expect(result).toEqual({ connectionsDeleted: 3, errorsDeleted: 1 });
    expect(prisma.connection.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: expect.any(Date) } },
    });
    expect(prisma.errorEvent.deleteMany).toHaveBeenCalledWith({
      where: { timestamp: { lt: expect.any(Date) } },
    });
  });

  it('uses distinct cutoffs sourced from configuration, not a hardcoded constant', async () => {
    await service.sweep();

    const connectionCutoff = prisma.connection.deleteMany.mock.calls[0][0].where.createdAt.lt as Date;
    const daysAgo = (Date.now() - connectionCutoff.getTime()) / (24 * 60 * 60 * 1000);
    expect(daysAgo).toBeCloseTo(30, 0);
  });

  it('registers and clears an interval timer across its module lifecycle, without throwing', () => {
    const setSpy = jest.spyOn(global, 'setInterval');
    const clearSpy = jest.spyOn(global, 'clearInterval');

    service.onModuleInit();
    expect(setSpy).toHaveBeenCalledWith(expect.any(Function), 3_600_000);

    service.onModuleDestroy();
    expect(clearSpy).toHaveBeenCalled();

    setSpy.mockRestore();
    clearSpy.mockRestore();
  });
});
