import { Injectable } from '@nestjs/common';
import { ConnectionState } from '../../generated/prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';

const RANGE_MS: Record<string, number> = {
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

export interface ObservabilityOverview {
  range: string;
  activeRooms: number;
  activeParticipants: number;
  connections: number;
  connectionSuccessRate: number | null;
  reconnectionRate: number | null;
  averageConnectionDurationMs: number | null;
  errors: number;
}

/**
 * Aggregates the `Connection`/`ErrorEvent` tables into the Raven-facing
 * numbers the dashboard Overview and `raven status`/`raven diagnostics`
 * show (Phase 9 spec §15/§26). Every number here comes from real rows;
 * an empty project legitimately reports zeros/`null`, never a fabricated
 * percentage (spec §36). Uses plain `findMany` + in-memory dedup for
 * distinct room/participant counts, not a `GROUP BY`, which is
 * simple and correct at the connection volumes this phase targets; a
 * larger deployment would replace this with real SQL aggregation.
 */
@Injectable()
export class MetricsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(projectId: string, range = '1h'): Promise<ObservabilityOverview> {
    const windowMs = RANGE_MS[range] ?? RANGE_MS['1h'];
    const since = new Date(Date.now() - windowMs);

    const [active, windowed, errorCount] = await Promise.all([
      this.prisma.connection.findMany({
        where: {
          projectId,
          state: { in: [ConnectionState.CONNECTING, ConnectionState.CONNECTED, ConnectionState.RECONNECTING] },
        },
        select: { roomId: true, participantIdentity: true },
      }),
      this.prisma.connection.findMany({
        where: { projectId, createdAt: { gte: since } },
        select: { connectedAt: true, reconnectCount: true, durationMs: true },
      }),
      this.prisma.errorEvent.count({ where: { projectId, timestamp: { gte: since } } }),
    ]);

    const activeRooms = new Set(active.map((c) => c.roomId).filter((id): id is string => Boolean(id))).size;
    const activeParticipants = new Set(active.map((c) => c.participantIdentity)).size;

    const total = windowed.length;
    const connectedCount = windowed.filter((c) => c.connectedAt).length;
    const reconnectedCount = windowed.filter((c) => c.reconnectCount > 0).length;
    const durations = windowed.map((c) => c.durationMs).filter((d): d is number => typeof d === 'number');

    return {
      range,
      activeRooms,
      activeParticipants,
      connections: total,
      connectionSuccessRate: total > 0 ? round1((connectedCount / total) * 100) : null,
      reconnectionRate: total > 0 ? round1((reconnectedCount / total) * 100) : null,
      averageConnectionDurationMs:
        durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
      errors: errorCount,
    };
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
