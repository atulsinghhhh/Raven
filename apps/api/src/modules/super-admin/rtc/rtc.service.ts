import { Injectable } from '@nestjs/common';
import { Connection, Participant, Prisma } from '../../../generated/prisma/client';
import { ConnectionState, ParticipantStatus, RoomStatus, RtcServerStatus } from '../../../generated/prisma/enums';
import { PrismaService } from '../../../shared/database/prisma.service';
import { NotFoundError } from '../../../shared/errors/app-error';
import { QueryRtcRoomsDto } from './dto/query-rtc-rooms.dto';

const RANGE_MS: Record<string, number> = {
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
};

const DEFAULT_RANGE = '24h';

export interface RtcSfuNode {
  id: string;
  name: string;
  region: string;
  status: RtcServerStatus;
  activeRooms: number;
  activeParticipants: number;
  capacity: number;
  cpuPercent: number | null;
  memoryPercent: number | null;
  version: string | null;
  lastHeartbeatAt: Date | null;
  registeredAt: Date;
}

export interface RtcOverview {
  range: string;
  activeRooms: number;
  activeParticipants: number;
  /** Fleet-reported concurrent participants (sum of each SFU node's own last-heartbeat count) — a live, independent cross-check against `activeParticipants`, which is the DB's own count of `Participant.status = JOINED`. The two can disagree briefly; that gap is itself diagnostic. */
  concurrentParticipants: number;
  roomsCreatedToday: number;
  roomsEndedToday: number;
  rtcMinutesToday: number;
  rtcMinutesPeriod: number;
  connectionFailures: number;
  reconnections: number;
  /** Null when there were zero connections in the window — never a fabricated 0%. */
  reconnectRate: number | null;
  /** Null when there were zero completed sessions in the window. */
  averageSessionDurationMs: number | null;
  sfu: {
    totalNodes: number;
    healthyNodes: number;
    drainingNodes: number;
    unhealthyNodes: number;
    nodes: RtcSfuNode[];
  };
}

export interface RtcRoomListItem {
  id: string;
  name: string;
  status: RoomStatus;
  environment: string;
  projectId: string;
  projectName: string;
  developerId: string;
  developerEmail: string;
  participantCount: number;
  rtcServer: { id: string; name: string; region: string; status: RtcServerStatus } | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RtcRoomListPage {
  items: RtcRoomListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface RtcRoomParticipantSummary {
  id: string;
  identity: string;
  status: ParticipantStatus;
  joinedAt: Date | null;
  leftAt: Date | null;
  durationMs: number | null;
  reconnectCount: number;
  connectionState: ConnectionState | null;
  connectionQuality: string | null;
}

export interface RtcRoomDetail {
  id: string;
  name: string;
  status: RoomStatus;
  environment: string;
  projectId: string;
  projectName: string;
  developerId: string;
  developerEmail: string;
  createdAt: Date;
  startedAt: Date;
  endedAt: Date | null;
  durationMs: number;
  participantCount: number;
  /** Best-effort, derived from stored `Connection` intervals for this room — see computePeakConcurrent(). Not a true instantaneous gauge; there is no time-series table recording simultaneous occupancy. */
  peakParticipants: number;
  connectionFailures: number;
  rtcServer: { id: string; name: string; region: string; status: RtcServerStatus } | null;
  participants: RtcRoomParticipantSummary[];
}

export interface RtcParticipantDetail {
  id: string;
  identity: string;
  status: ParticipantStatus;
  room: {
    id: string;
    name: string;
    status: RoomStatus;
    projectId: string;
    projectName: string;
    developerId: string;
    developerEmail: string;
  };
  joinedAt: Date | null;
  leftAt: Date | null;
  durationMs: number | null;
  reconnectCount: number;
  connectionState: ConnectionState | null;
  connectionQuality: string | null;
  networkQuality: {
    rttMs: number | null;
    jitterMs: number | null;
    packetLossPercent: number | null;
    bitrateBps: number | null;
  };
  rtcTokens: { id: string; permissions: Prisma.JsonValue; expiresAt: Date; createdAt: Date }[];
  connections: {
    id: string;
    state: ConnectionState;
    startedAt: Date;
    connectedAt: Date | null;
    disconnectedAt: Date | null;
    durationMs: number | null;
    reconnectCount: number;
    disconnectReason: string | null;
    region: string | null;
    connectionQuality: string | null;
    rttMs: number | null;
    jitterMs: number | null;
    packetLossPercent: number | null;
  }[];
}

/**
 * Platform-wide RTC operations (spec §10). Deliberately not project-scoped —
 * every query here spans every project on the deployment, which is the one
 * thing the existing per-project `MetricsService`/`ConnectionsService`
 * (apps/api/src/modules/observability) structurally cannot do.
 *
 * `Connection.roomId`/`participantIdentity` are best-effort telemetry
 * fields, not enforced foreign keys (see ConnectionsService's own doc
 * comment) — `rid` in a signed RTC token is minted from the real `Room.id`
 * (RtcTokenSignerService), so joining on equality here is correct, just not
 * database-enforced. No media content is stored anywhere in this schema, so
 * there is nothing of that kind to leak through this surface.
 */
@Injectable()
export class RtcService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(range = DEFAULT_RANGE): Promise<RtcOverview> {
    const windowMs = RANGE_MS[range] ?? RANGE_MS[DEFAULT_RANGE];
    const resolvedRange = RANGE_MS[range] ? range : DEFAULT_RANGE;
    const since = new Date(Date.now() - windowMs);
    const startOfDay = startOfDayUtc(new Date());

    const [
      activeRooms,
      activeParticipants,
      roomsCreatedToday,
      roomsEndedToday,
      sfuServers,
      minutesTodayAgg,
      minutesPeriodAgg,
      connectionFailures,
      reconnectAgg,
      avgDurationAgg,
    ] = await Promise.all([
      this.prisma.room.count({ where: { status: RoomStatus.ACTIVE } }),
      this.prisma.participant.count({ where: { status: ParticipantStatus.JOINED } }),
      this.prisma.room.count({ where: { createdAt: { gte: startOfDay } } }),
      this.prisma.room.count({ where: { status: RoomStatus.CLOSED, updatedAt: { gte: startOfDay } } }),
      this.prisma.rtcServer.findMany({ orderBy: [{ region: 'asc' }, { name: 'asc' }] }),
      this.prisma.connection.aggregate({
        _sum: { durationMs: true },
        where: { createdAt: { gte: startOfDay }, durationMs: { not: null } },
      }),
      this.prisma.connection.aggregate({
        _sum: { durationMs: true },
        where: { createdAt: { gte: since }, durationMs: { not: null } },
      }),
      this.prisma.connection.count({ where: { state: ConnectionState.FAILED, createdAt: { gte: since } } }),
      this.prisma.connection.aggregate({
        _sum: { reconnectCount: true },
        _count: { _all: true },
        where: { createdAt: { gte: since } },
      }),
      this.prisma.connection.aggregate({
        _avg: { durationMs: true },
        where: { createdAt: { gte: since }, durationMs: { not: null } },
      }),
    ]);

    const connectionsInPeriod = reconnectAgg._count._all;
    const reconnections = reconnectAgg._sum.reconnectCount ?? 0;
    const reconnectRate = connectionsInPeriod === 0 ? null : reconnections / connectionsInPeriod;
    const concurrentParticipants = sfuServers.reduce((sum, s) => sum + s.activeParticipants, 0);

    return {
      range: resolvedRange,
      activeRooms,
      activeParticipants,
      concurrentParticipants,
      roomsCreatedToday,
      roomsEndedToday,
      rtcMinutesToday: msToMinutes(minutesTodayAgg._sum.durationMs),
      rtcMinutesPeriod: msToMinutes(minutesPeriodAgg._sum.durationMs),
      connectionFailures,
      reconnections,
      reconnectRate,
      averageSessionDurationMs: avgDurationAgg._avg.durationMs ?? null,
      sfu: {
        totalNodes: sfuServers.length,
        healthyNodes: sfuServers.filter((s) => s.status === RtcServerStatus.HEALTHY).length,
        drainingNodes: sfuServers.filter((s) => s.status === RtcServerStatus.DRAINING).length,
        unhealthyNodes: sfuServers.filter((s) => s.status === RtcServerStatus.UNHEALTHY).length,
        nodes: sfuServers.map((s) => ({
          id: s.id,
          name: s.name,
          region: s.region,
          status: s.status,
          activeRooms: s.activeRooms,
          activeParticipants: s.activeParticipants,
          capacity: s.capacity,
          cpuPercent: s.cpuPercent,
          memoryPercent: s.memoryPercent,
          version: s.version,
          lastHeartbeatAt: s.lastHeartbeatAt,
          registeredAt: s.registeredAt,
        })),
      },
    };
  }

  async listRooms(query: QueryRtcRoomsDto): Promise<RtcRoomListPage> {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    const where: Prisma.RoomWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };

    const [rooms, total] = await Promise.all([
      this.prisma.room.findMany({
        where,
        include: {
          project: { include: { owner: { select: { id: true, email: true } } } },
          rtcServer: { select: { id: true, name: true, region: true, status: true } },
          _count: { select: { participants: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.room.count({ where }),
    ]);

    return {
      items: rooms.map((room) => ({
        id: room.id,
        name: room.name,
        status: room.status,
        environment: room.environment,
        projectId: room.projectId,
        projectName: room.project.name,
        developerId: room.project.owner.id,
        developerEmail: room.project.owner.email,
        participantCount: room._count.participants,
        rtcServer: room.rtcServer
          ? { id: room.rtcServer.id, name: room.rtcServer.name, region: room.rtcServer.region, status: room.rtcServer.status }
          : null,
        createdAt: room.createdAt,
        updatedAt: room.updatedAt,
      })),
      total,
      limit,
      offset,
    };
  }

  async getRoomDetail(roomId: string): Promise<RtcRoomDetail> {
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      include: {
        project: { include: { owner: { select: { id: true, email: true } } } },
        rtcServer: { select: { id: true, name: true, region: true, status: true } },
        participants: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!room) {
      throw new NotFoundError('Room');
    }

    // Connection.roomId is best-effort telemetry, not an enforced FK (see
    // class doc comment), but it is populated from the same Room.id a
    // signed RTC token is minted with, so this equality join is correct.
    const connections = await this.prisma.connection.findMany({
      where: { roomId: room.id },
      orderBy: { startedAt: 'asc' },
    });

    const connectionFailures = connections.filter((c) => c.state === ConnectionState.FAILED).length;
    const peakParticipants = computePeakConcurrent(connections);

    const connectionsByIdentity = new Map<string, Connection[]>();
    for (const connection of connections) {
      const bucket = connectionsByIdentity.get(connection.participantIdentity) ?? [];
      bucket.push(connection);
      connectionsByIdentity.set(connection.participantIdentity, bucket);
    }

    const ended = room.status === RoomStatus.CLOSED ? room.updatedAt : null;
    const durationMs = (ended ?? new Date()).getTime() - room.createdAt.getTime();

    return {
      id: room.id,
      name: room.name,
      status: room.status,
      environment: room.environment,
      projectId: room.projectId,
      projectName: room.project.name,
      developerId: room.project.owner.id,
      developerEmail: room.project.owner.email,
      createdAt: room.createdAt,
      // Room has no separate "started" timestamp — a room exists from the
      // moment it's created (RoomsService.create), so createdAt is the
      // honest answer, not an invented one.
      startedAt: room.createdAt,
      endedAt: ended,
      durationMs,
      participantCount: room.participants.length,
      peakParticipants,
      connectionFailures,
      rtcServer: room.rtcServer
        ? { id: room.rtcServer.id, name: room.rtcServer.name, region: room.rtcServer.region, status: room.rtcServer.status }
        : null,
      participants: room.participants.map((participant) =>
        summarizeParticipant(participant, connectionsByIdentity.get(participant.identity) ?? []),
      ),
    };
  }

  async getParticipantDetail(participantId: string): Promise<RtcParticipantDetail> {
    const participant = await this.prisma.participant.findUnique({
      where: { id: participantId },
      include: {
        room: { include: { project: { include: { owner: { select: { id: true, email: true } } } } } },
        rtcTokens: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!participant) {
      throw new NotFoundError('Participant');
    }

    const connections = await this.prisma.connection.findMany({
      where: { roomId: participant.roomId, participantIdentity: participant.identity },
      orderBy: { startedAt: 'asc' },
    });

    const summary = summarizeParticipant(participant, connections);
    const latest = connections[connections.length - 1];

    return {
      id: participant.id,
      identity: participant.identity,
      status: participant.status,
      room: {
        id: participant.room.id,
        name: participant.room.name,
        status: participant.room.status,
        projectId: participant.room.projectId,
        projectName: participant.room.project.name,
        developerId: participant.room.project.owner.id,
        developerEmail: participant.room.project.owner.email,
      },
      joinedAt: summary.joinedAt,
      leftAt: summary.leftAt,
      durationMs: summary.durationMs,
      reconnectCount: summary.reconnectCount,
      connectionState: summary.connectionState,
      connectionQuality: summary.connectionQuality,
      networkQuality: {
        rttMs: latest?.rttMs ?? null,
        jitterMs: latest?.jitterMs ?? null,
        packetLossPercent: latest?.packetLossPercent ?? null,
        bitrateBps: latest?.bitrateBps ?? null,
      },
      // RtcToken.permissions is capability flags (canPublish/canSubscribe/…),
      // never a secret — the signed JWT itself is never persisted anywhere.
      rtcTokens: participant.rtcTokens.map((token) => ({
        id: token.id,
        permissions: token.permissions,
        expiresAt: token.expiresAt,
        createdAt: token.createdAt,
      })),
      connections: connections.map((connection) => ({
        id: connection.publicId,
        state: connection.state,
        startedAt: connection.startedAt,
        connectedAt: connection.connectedAt,
        disconnectedAt: connection.disconnectedAt,
        durationMs: connection.durationMs,
        reconnectCount: connection.reconnectCount,
        disconnectReason: connection.disconnectReason,
        region: connection.region,
        connectionQuality: connection.connectionQuality,
        rttMs: connection.rttMs,
        jitterMs: connection.jitterMs,
        packetLossPercent: connection.packetLossPercent,
      })),
    };
  }
}

function msToMinutes(ms: number | null): number {
  return ms ? Math.round((ms / 60000) * 100) / 100 : 0;
}

function startOfDayUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * One participant's join/leave/duration/reconnects/quality, derived from its
 * `Connection` rows for this room (matched by `participantIdentity`). A
 * participant can have more than one connection row across reconnects, so
 * this folds them into one summary rather than presenting a raw list.
 */
function summarizeParticipant(participant: Participant, connections: Connection[]): RtcRoomParticipantSummary {
  const connectedTimes = connections.map((c) => c.connectedAt).filter((d): d is Date => d !== null);
  const joinedAt = connectedTimes.length > 0 ? new Date(Math.min(...connectedTimes.map((d) => d.getTime()))) : null;

  const leftAt =
    participant.status === ParticipantStatus.LEFT
      ? (() => {
          const disconnectedTimes = connections.map((c) => c.disconnectedAt).filter((d): d is Date => d !== null);
          return disconnectedTimes.length > 0
            ? new Date(Math.max(...disconnectedTimes.map((d) => d.getTime())))
            : null;
        })()
      : null;

  const knownDurations = connections.map((c) => c.durationMs).filter((d): d is number => d !== null);
  // Sum of completed connection durations. Null (not 0) while the
  // participant's only connection is still open and has no durationMs yet —
  // an ongoing session has no duration to report, not a zero-length one.
  const durationMs = knownDurations.length > 0 ? knownDurations.reduce((a, b) => a + b, 0) : null;

  const reconnectCount = connections.reduce((sum, c) => sum + c.reconnectCount, 0);
  const latest = connections[connections.length - 1];

  return {
    id: participant.id,
    identity: participant.identity,
    status: participant.status,
    joinedAt,
    leftAt,
    durationMs,
    reconnectCount,
    connectionState: latest?.state ?? null,
    connectionQuality: latest?.connectionQuality ?? null,
  };
}

/**
 * Peak concurrent participants for a room, swept from real `Connection`
 * intervals (`connectedAt ?? startedAt` through `disconnectedAt ?? now`) —
 * a real number derived from stored telemetry, not an invented one. Counts
 * connection rows, not distinct identities, so a participant who reconnects
 * while briefly overlapping their own prior (not-yet-closed) connection row
 * could inflate the peak by one; that's a narrow edge case inherent to
 * best-effort telemetry, the same caveat `MetricsService`/`OverviewService`
 * already carry for their own concurrency numbers.
 */
function computePeakConcurrent(connections: Connection[]): number {
  if (connections.length === 0) return 0;

  const now = Date.now();
  const events: { t: number; delta: number }[] = [];

  for (const connection of connections) {
    const start = (connection.connectedAt ?? connection.startedAt).getTime();
    const end = (connection.disconnectedAt ?? new Date(now)).getTime();
    if (end < start) continue;
    events.push({ t: start, delta: 1 });
    events.push({ t: end, delta: -1 });
  }

  // A leave and a join at the exact same instant is processed leave-first,
  // so two connections that hand off at the same millisecond don't get
  // double-counted as a momentary peak of one higher than either ever was.
  events.sort((a, b) => a.t - b.t || a.delta - b.delta);

  let running = 0;
  let peak = 0;
  for (const event of events) {
    running += event.delta;
    peak = Math.max(peak, running);
  }
  return peak;
}
