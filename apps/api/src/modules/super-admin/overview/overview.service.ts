import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AccountStatus,
  ActivityEventType,
  ConnectionState,
  ConversationStatus,
  LiveStreamEgressStatus,
  LiveStreamStatus,
  ParticipantStatus,
  ProjectStatus,
  RoomStatus,
} from '../../../generated/prisma/enums';
import { PrismaService } from '../../../shared/database/prisma.service';
import { RedisService } from '../../../shared/redis/redis.service';
import { checkSfuHttp, checkStunBinding } from '../../health/dependency-checks.util';
import { RtcServerRegistryService } from '../../rtc-servers/rtc-server-registry.service';

type DependencyStatus = 'up' | 'down';

export interface OverviewResponse {
  generatedAt: string;
  developers: {
    total: number;
    newToday: number;
    newThisWeek: number;
    active: number;
    inactive: number;
    suspended: number;
  };
  projects: {
    total: number;
    active: number;
    newToday: number;
    newThisWeek: number;
  };
  rtc: {
    activeRooms: number;
    activeParticipants: number;
    roomsCreatedToday: number;
    minutesToday: number;
    minutesThisMonth: number;
    /** Null when there were no rooms today to measure — see getRtc(). */
    peakConcurrentParticipantsToday: number | null;
    failedConnectionsToday: number;
    /** Null when there were zero connections today, per the plan's spec. */
    reconnectRateToday: number | null;
  };
  chat: {
    messagesToday: number;
    messagesThisMonth: number;
    activeConversations: number;
    activeChatUsers: number;
    failedMessagesToday: number;
  };
  liveStreaming: {
    activeStreams: number;
    streamsToday: number;
    /** Proxy for "total viewers" — see getLiveStreaming(). */
    totalViewersToday: number;
    peakViewersToday: number;
    /** Null when no stream ended today. */
    avgStreamDurationMsToday: number | null;
    failedStreams: number;
  };
  infrastructure: {
    api: DependencyStatus;
    database: DependencyStatus;
    redis: DependencyStatus;
    sfu: DependencyStatus;
    turn: DependencyStatus;
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Bound for the dependency probes below, matching HealthController's own ceiling. */
const DEPENDENCY_CHECK_TIMEOUT_MS = 2000;

/**
 * Real Prisma aggregation queries backing the Overview dashboard (spec
 * §4/§5). Every number here comes from `count()`/`groupBy()`/`aggregate()`
 * against tables that already exist — nothing is invented, and anywhere a
 * true metric would require infrastructure this pass doesn't add (e.g. a
 * genuine "concurrent at any instant" gauge, which needs a time-series
 * store, not a snapshot query) the comment on that field says so.
 */
@Injectable()
export class OverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly configService: ConfigService,
    private readonly rtcServers: RtcServerRegistryService,
  ) {}

  async getOverview(): Promise<OverviewResponse> {
    const now = new Date();
    const startOfDay = startOfDayUtc(now);
    const startOfWeek = startOfWeekUtc(now);
    const startOfMonth = startOfMonthUtc(now);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);

    const [developers, projects, rtc, chat, liveStreaming, infrastructure] = await Promise.all([
      this.getDevelopers(startOfDay, startOfWeek, thirtyDaysAgo),
      this.getProjects(startOfDay, startOfWeek),
      this.getRtc(startOfDay, startOfMonth),
      this.getChat(startOfDay, startOfMonth),
      this.getLiveStreaming(startOfDay),
      this.getInfrastructure(),
    ]);

    return {
      generatedAt: now.toISOString(),
      developers,
      projects,
      rtc,
      chat,
      liveStreaming,
      infrastructure,
    };
  }

  private async getDevelopers(startOfDay: Date, startOfWeek: Date, thirtyDaysAgo: Date) {
    const [total, newToday, newThisWeek, suspended, activeRows] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { createdAt: { gte: startOfDay } } }),
      this.prisma.user.count({ where: { createdAt: { gte: startOfWeek } } }),
      this.prisma.user.count({ where: { status: AccountStatus.SUSPENDED } }),
      // "Active" = at least one ActivityEvent attributed to them in the
      // last 30 days. Distinct developerId, not a raw row count, since one
      // developer logging in daily must count once, not thirty times.
      this.prisma.activityEvent.findMany({
        where: { developerId: { not: null }, createdAt: { gte: thirtyDaysAgo } },
        select: { developerId: true },
        distinct: ['developerId'],
      }),
    ]);

    const active = activeRows.length;
    // Floored at 0: a developer created after `thirtyDaysAgo` who is also
    // active would otherwise make this arithmetic go negative if `total`
    // were read from a stale replica lagging behind `active`'s query.
    const inactive = Math.max(total - active, 0);

    return { total, newToday, newThisWeek, active, inactive, suspended };
  }

  private async getProjects(startOfDay: Date, startOfWeek: Date) {
    const [total, active, newToday, newThisWeek] = await Promise.all([
      this.prisma.project.count(),
      this.prisma.project.count({ where: { status: ProjectStatus.ACTIVE } }),
      this.prisma.project.count({ where: { createdAt: { gte: startOfDay } } }),
      this.prisma.project.count({ where: { createdAt: { gte: startOfWeek } } }),
    ]);

    return { total, active, newToday, newThisWeek };
  }

  private async getRtc(startOfDay: Date, startOfMonth: Date) {
    const [
      activeRooms,
      activeParticipants,
      roomsCreatedToday,
      minutesTodayAgg,
      minutesMonthAgg,
      peakGroups,
      failedConnectionsToday,
      reconnectAgg,
    ] = await Promise.all([
      this.prisma.room.count({ where: { status: RoomStatus.ACTIVE } }),
      this.prisma.participant.count({ where: { status: ParticipantStatus.JOINED } }),
      this.prisma.room.count({ where: { createdAt: { gte: startOfDay } } }),
      this.prisma.connection.aggregate({
        _sum: { durationMs: true },
        where: { connectedAt: { gte: startOfDay }, durationMs: { not: null } },
      }),
      this.prisma.connection.aggregate({
        _sum: { durationMs: true },
        where: { connectedAt: { gte: startOfMonth }, durationMs: { not: null } },
      }),
      // Best-effort "peak concurrent participants": there is no time-series
      // table recording simultaneous occupancy, so a true instantaneous
      // peak isn't computable without new infrastructure. As the most
      // defensible proxy available today, this takes the largest
      // "participants who joined today" count across any single room —
      // an upper bound on that room's true concurrency, not an exact
      // reading of any single moment.
      this.prisma.participant.groupBy({
        by: ['roomId'],
        where: { status: ParticipantStatus.JOINED, createdAt: { gte: startOfDay } },
        _count: { _all: true },
      }),
      this.prisma.connection.count({
        where: { state: ConnectionState.FAILED, createdAt: { gte: startOfDay } },
      }),
      this.prisma.connection.aggregate({
        _sum: { reconnectCount: true },
        _count: { _all: true },
        where: { createdAt: { gte: startOfDay } },
      }),
    ]);

    const peakConcurrentParticipantsToday =
      peakGroups.length === 0 ? null : Math.max(...peakGroups.map((g) => g._count._all));

    const connectionsToday = reconnectAgg._count._all;
    const reconnectRateToday =
      connectionsToday === 0 ? null : (reconnectAgg._sum.reconnectCount ?? 0) / connectionsToday;

    return {
      activeRooms,
      activeParticipants,
      roomsCreatedToday,
      minutesToday: msToMinutes(minutesTodayAgg._sum.durationMs),
      minutesThisMonth: msToMinutes(minutesMonthAgg._sum.durationMs),
      peakConcurrentParticipantsToday,
      failedConnectionsToday,
      reconnectRateToday,
    };
  }

  private async getChat(startOfDay: Date, startOfMonth: Date) {
    const [messagesToday, messagesThisMonth, activeConversations, activeChatUserRows, failedMessagesToday] =
      await Promise.all([
        this.prisma.message.count({ where: { createdAt: { gte: startOfDay }, deletedAt: null } }),
        this.prisma.message.count({ where: { createdAt: { gte: startOfMonth }, deletedAt: null } }),
        this.prisma.conversation.count({ where: { status: ConversationStatus.ACTIVE } }),
        this.prisma.chatConnection.findMany({
          where: { state: ConnectionState.CONNECTED },
          select: { userId: true },
          distinct: ['userId'],
        }),
        // Best effort: CHAT_MESSAGE_FAILED isn't wired into the hot chat
        // send path yet (see implementation-plan.md §4), so this is
        // expected to read 0 today. That's the real count, not a
        // fabricated one — it will start reflecting reality the moment a
        // future pass emits that event.
        this.prisma.activityEvent.count({
          where: { eventType: ActivityEventType.CHAT_MESSAGE_FAILED, createdAt: { gte: startOfDay } },
        }),
      ]);

    return {
      messagesToday,
      messagesThisMonth,
      activeConversations,
      activeChatUsers: activeChatUserRows.length,
      failedMessagesToday,
    };
  }

  private async getLiveStreaming(startOfDay: Date) {
    const [activeStreams, streamsToday, viewerAgg, endedToday, failedStreams] = await Promise.all([
      this.prisma.liveStream.count({ where: { status: LiveStreamStatus.LIVE } }),
      this.prisma.liveStream.count({ where: { createdAt: { gte: startOfDay } } }),
      // LiveStream has no running "total viewers" counter, only a
      // per-stream `peakViewerCount`. Summing it across today's streams is
      // the closest available proxy for "total viewers today"; the max of
      // the same column is used for "peak viewers today". Both are
      // real numbers from the real column, just not the exact metric a
      // dedicated viewer-count table would give.
      this.prisma.liveStream.aggregate({
        _sum: { peakViewerCount: true },
        _max: { peakViewerCount: true },
        where: { createdAt: { gte: startOfDay } },
      }),
      // Average stream duration needs a per-row (endedAt - startedAt)
      // difference, which Prisma's aggregate API can't express directly
      // without raw SQL. With only "ended today" rows in play the set is
      // small, so this fetches the two timestamps and averages in
      // application code rather than reaching for $queryRaw.
      this.prisma.liveStream.findMany({
        where: { endedAt: { gte: startOfDay }, startedAt: { not: null } },
        select: { startedAt: true, endedAt: true },
      }),
      // No clean "this stream failed" boolean exists on LiveStream itself
      // (status only ever reflects the host's own RTC lifecycle). The
      // egress worker's status is the best real signal for a failure,
      // since a BROADCAST-mode stream whose HLS pipeline died is the
      // concrete "failed" case operators care about. Not time-boxed to
      // today: egress failures are rare enough that an all-time count is
      // more useful than a "today" one that's usually zero.
      this.prisma.liveStreamEgress.count({ where: { status: LiveStreamEgressStatus.FAILED } }),
    ]);

    const durations = endedToday
      .filter((s) => s.startedAt && s.endedAt)
      .map((s) => s.endedAt!.getTime() - s.startedAt!.getTime());
    const avgStreamDurationMsToday =
      durations.length === 0 ? null : durations.reduce((a, b) => a + b, 0) / durations.length;

    return {
      activeStreams,
      streamsToday,
      totalViewersToday: viewerAgg._sum.peakViewerCount ?? 0,
      peakViewersToday: viewerAgg._max.peakViewerCount ?? 0,
      avgStreamDurationMsToday,
      failedStreams,
    };
  }

  /**
   * Reuses the exact same lower-level checks `HealthController` and
   * `DiagnosticsService` already run (`PrismaService.ping`,
   * `RedisService.ping`, `checkSfuHttp`/`checkStunBinding` against the
   * registered RTC fleet) rather than re-implementing pings here. `api`
   * is trivially 'up': reaching this method at all already proves the
   * API process is answering, same reasoning `DiagnosticsService` uses.
   */
  private async getInfrastructure() {
    const [database, redis, sfu, turn] = await Promise.all([
      this.probe(() => this.prisma.ping()),
      this.probe(() => this.redis.ping()),
      this.probe(async () => {
        const region = this.configService.get<string>('sfu.defaultRegion')!;
        const candidates = await this.rtcServers.listHealthyForProbe(region);
        if (candidates.length === 0) throw new Error('no healthy rtc server registered');
        for (const candidate of candidates) {
          if (await checkSfuHttp(candidate.internalUrl)) return;
        }
        throw new Error('unreachable');
      }),
      this.probe(async () => {
        const ok = await checkStunBinding(
          this.configService.get<string>('turn.internalHost')!,
          this.configService.get<number>('turn.port')!,
        );
        if (!ok) throw new Error('unreachable');
      }),
    ]);

    return { api: 'up' as const, database, redis, sfu, turn };
  }

  private async probe(fn: () => Promise<void>): Promise<DependencyStatus> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        fn(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), DEPENDENCY_CHECK_TIMEOUT_MS);
        }),
      ]);
      return 'up';
    } catch {
      return 'down';
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

function msToMinutes(ms: number | null): number {
  return ms ? ms / 60000 : 0;
}

function startOfDayUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Most recent Monday, 00:00 UTC — there's no platform-wide "week starts on" setting to defer to. */
function startOfWeekUtc(now: Date): Date {
  const start = startOfDayUtc(now);
  const day = start.getUTCDay(); // 0 = Sunday ... 6 = Saturday
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  start.setUTCDate(start.getUTCDate() - daysSinceMonday);
  return start;
}

function startOfMonthUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
