import { PrismaService } from '../../shared/database/prisma.service';
import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  let service: MetricsService;
  let prisma: {
    connection: { findMany: jest.Mock };
    errorEvent: { count: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      connection: { findMany: jest.fn() },
      errorEvent: { count: jest.fn() },
    };
    service = new MetricsService(prisma as unknown as PrismaService);
  });

  it('reports all-null/zero for a project with no connections — never a fabricated percentage', async () => {
    prisma.connection.findMany.mockResolvedValue([]);
    prisma.errorEvent.count.mockResolvedValue(0);

    const overview = await service.getOverview('project-1');

    expect(overview).toEqual({
      range: '1h',
      activeRooms: 0,
      activeParticipants: 0,
      connections: 0,
      connectionSuccessRate: null,
      reconnectionRate: null,
      averageConnectionDurationMs: null,
      errors: 0,
    });
  });

  it('computes real success/reconnection rates and average duration from actual rows', async () => {
    prisma.connection.findMany
      .mockResolvedValueOnce([{ roomId: 'room-1', participantIdentity: 'alice' }]) // active
      .mockResolvedValueOnce([
        { connectedAt: new Date(), reconnectCount: 0, durationMs: 1000 },
        { connectedAt: new Date(), reconnectCount: 1, durationMs: 3000 },
        { connectedAt: null, reconnectCount: 0, durationMs: null },
      ]); // windowed
    prisma.errorEvent.count.mockResolvedValue(2);

    const overview = await service.getOverview('project-1', '24h');

    expect(overview.activeRooms).toBe(1);
    expect(overview.activeParticipants).toBe(1);
    expect(overview.connections).toBe(3);
    expect(overview.connectionSuccessRate).toBeCloseTo((2 / 3) * 100, 1);
    expect(overview.reconnectionRate).toBeCloseTo((1 / 3) * 100, 1);
    expect(overview.averageConnectionDurationMs).toBe(2000);
    expect(overview.errors).toBe(2);
  });

  it('dedupes active room/participant counts across multiple connections', async () => {
    prisma.connection.findMany
      .mockResolvedValueOnce([
        { roomId: 'room-1', participantIdentity: 'alice' },
        { roomId: 'room-1', participantIdentity: 'bob' },
        { roomId: 'room-2', participantIdentity: 'alice' },
      ])
      .mockResolvedValueOnce([]);
    prisma.errorEvent.count.mockResolvedValue(0);

    const overview = await service.getOverview('project-1');

    expect(overview.activeRooms).toBe(2);
    expect(overview.activeParticipants).toBe(2);
  });
});
