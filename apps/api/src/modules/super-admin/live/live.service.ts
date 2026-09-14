import { Injectable, NotFoundException } from '@nestjs/common';
import { LiveStreamEgressStatus, LiveStreamStatus } from '../../../generated/prisma/enums';
import { PrismaService } from '../../../shared/database/prisma.service';
import { QueryLiveStreamsDto } from './dto/query-live-streams.dto';

export interface LiveOverviewResponse {
  generatedAt: string;
  activeStreams: number;
  streamsToday: number;
  totalStreams: number;
  totalViewersToday: number;
  peakViewersToday: number;
  peakViewersAllTime: number;
  /** Sum of (endedAt - startedAt) across streams that ended today. */
  sumStreamDurationMsToday: number;
  /** Null when no stream ended today — never a fabricated 0. */
  avgStreamDurationMsToday: number | null;
  /** LiveStreamEgress rows stuck in FAILED, all-time — see OverviewService.getLiveStreaming() for the same reasoning: no clean "this stream failed" boolean exists on LiveStream itself. */
  failedStreams: number;
}

export interface LiveStreamListItem {
  id: string;
  projectId: string;
  projectName: string;
  ownerEmail: string;
  environment: string;
  title: string;
  status: LiveStreamStatus;
  deliveryMode: string;
  visibility: string;
  hostIdentity: string | null;
  peakViewerCount: number;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
}

export interface LiveStreamPage {
  items: LiveStreamListItem[];
  total: number;
}

export interface LiveStreamHostDetail {
  id: string;
  identity: string;
  role: string;
  invitedAt: string;
  removedAt: string | null;
}

export interface LiveStreamEgressDetail {
  status: string;
  workerId: string | null;
  playbackUrl: string | null;
  hlsReadyAt: string | null;
  lastSegmentAt: string | null;
  lastError: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
}

export interface LiveStreamDetail extends LiveStreamListItem {
  description: string | null;
  thumbnailUrl: string | null;
  category: string | null;
  tags: string[];
  language: string | null;
  scheduledAt: string | null;
  updatedAt: string;
  conversationId: string | null;
  room: {
    id: string;
    name: string;
    status: string;
    rtcServerId: string | null;
    region: string | null;
  } | null;
  hosts: LiveStreamHostDetail[];
  egress: LiveStreamEgressDetail | null;
}

/**
 * Real Prisma queries backing the platform-wide Live Streaming section of
 * the Super Admin Portal (spec §12) — every `LiveStream` across every
 * project, not the single-project view `DashboardLiveStreamsController`
 * and `LiveStreamsService` already provide. Deliberately does not reuse
 * `LiveStreamsService`: that service takes a `ProjectScope` (one
 * `projectId` + `environment`) baked into every method, which is the
 * opposite of what a cross-project admin view needs, and it also carries
 * SFU/chat/webhook side effects this read-only surface has no business
 * triggering.
 */
@Injectable()
export class LiveService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(): Promise<LiveOverviewResponse> {
    const now = new Date();
    const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    const [activeStreams, streamsToday, totalStreams, todayViewerAgg, allTimePeakAgg, endedToday, failedStreams] =
      await Promise.all([
        this.prisma.liveStream.count({ where: { status: LiveStreamStatus.LIVE } }),
        this.prisma.liveStream.count({ where: { createdAt: { gte: startOfDay } } }),
        this.prisma.liveStream.count(),
        // No running "total viewers" counter exists — peakViewerCount is the
        // only viewer number LiveStream stores. Summing/maxing it across
        // today's streams is the same proxy OverviewService.getLiveStreaming()
        // already uses for the same reason.
        this.prisma.liveStream.aggregate({
          _sum: { peakViewerCount: true },
          _max: { peakViewerCount: true },
          where: { createdAt: { gte: startOfDay } },
        }),
        this.prisma.liveStream.aggregate({ _max: { peakViewerCount: true } }),
        // Prisma's aggregate API can't express a per-row (endedAt - startedAt)
        // difference, so this fetches the two timestamps for today's ended
        // streams and averages/sums in application code, same approach as
        // OverviewService.
        this.prisma.liveStream.findMany({
          where: { endedAt: { gte: startOfDay }, startedAt: { not: null } },
          select: { startedAt: true, endedAt: true },
        }),
        this.prisma.liveStreamEgress.count({ where: { status: LiveStreamEgressStatus.FAILED } }),
      ]);

    const durations = endedToday
      .filter((s) => s.startedAt && s.endedAt)
      .map((s) => s.endedAt!.getTime() - s.startedAt!.getTime());
    const sumStreamDurationMsToday = durations.reduce((a, b) => a + b, 0);
    const avgStreamDurationMsToday = durations.length === 0 ? null : sumStreamDurationMsToday / durations.length;

    return {
      generatedAt: now.toISOString(),
      activeStreams,
      streamsToday,
      totalStreams,
      totalViewersToday: todayViewerAgg._sum.peakViewerCount ?? 0,
      peakViewersToday: todayViewerAgg._max.peakViewerCount ?? 0,
      peakViewersAllTime: allTimePeakAgg._max.peakViewerCount ?? 0,
      sumStreamDurationMsToday,
      avgStreamDurationMsToday,
      failedStreams,
    };
  }

  async listStreams(query: QueryLiveStreamsDto): Promise<LiveStreamPage> {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    const where = {
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

    const [rows, total] = await Promise.all([
      this.prisma.liveStream.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: {
          project: { select: { id: true, name: true } },
          owner: { select: { id: true, email: true } },
          hosts: {
            where: { removedAt: null },
            orderBy: [{ role: 'asc' }, { invitedAt: 'asc' }],
            take: 1,
          },
        },
      }),
      this.prisma.liveStream.count({ where }),
    ]);

    return {
      items: rows.map((stream) => ({
        id: stream.publicId,
        projectId: stream.projectId,
        projectName: stream.project.name,
        ownerEmail: stream.owner.email,
        environment: stream.environment,
        title: stream.title,
        status: stream.status,
        deliveryMode: stream.deliveryMode,
        visibility: stream.visibility,
        hostIdentity: stream.hosts[0]?.identity ?? null,
        peakViewerCount: stream.peakViewerCount,
        startedAt: stream.startedAt?.toISOString() ?? null,
        endedAt: stream.endedAt?.toISOString() ?? null,
        createdAt: stream.createdAt.toISOString(),
      })),
      total,
    };
  }

  /** Public id (`stream_...`) or internal uuid — same dual-lookup convention `LiveStreamsService.resolveRaw` uses. */
  async getStream(streamId: string): Promise<LiveStreamDetail> {
    const stream = await this.prisma.liveStream.findUnique({
      where: streamId.startsWith('stream_') ? { publicId: streamId } : { id: streamId },
      include: {
        project: { select: { id: true, name: true } },
        owner: { select: { id: true, email: true } },
        hosts: { orderBy: [{ role: 'asc' }, { invitedAt: 'asc' }] },
        egress: true,
        room: { include: { rtcServer: { select: { id: true, region: true } } } },
      },
    });

    if (!stream) {
      throw new NotFoundException('Live stream not found');
    }

    return {
      id: stream.publicId,
      projectId: stream.projectId,
      projectName: stream.project.name,
      ownerEmail: stream.owner.email,
      environment: stream.environment,
      title: stream.title,
      description: stream.description,
      thumbnailUrl: stream.thumbnailUrl,
      category: stream.category,
      tags: stream.tags,
      language: stream.language,
      status: stream.status,
      deliveryMode: stream.deliveryMode,
      visibility: stream.visibility,
      hostIdentity: stream.hosts.find((h) => h.removedAt === null)?.identity ?? null,
      peakViewerCount: stream.peakViewerCount,
      scheduledAt: stream.scheduledAt?.toISOString() ?? null,
      startedAt: stream.startedAt?.toISOString() ?? null,
      endedAt: stream.endedAt?.toISOString() ?? null,
      createdAt: stream.createdAt.toISOString(),
      updatedAt: stream.updatedAt.toISOString(),
      conversationId: stream.conversationId,
      room: stream.room
        ? {
            id: stream.room.id,
            name: stream.room.name,
            status: stream.room.status,
            rtcServerId: stream.room.rtcServerId,
            region: stream.room.rtcServer?.region ?? null,
          }
        : null,
      hosts: stream.hosts.map((host) => ({
        id: host.id,
        identity: host.identity,
        role: host.role,
        invitedAt: host.invitedAt.toISOString(),
        removedAt: host.removedAt?.toISOString() ?? null,
      })),
      egress: stream.egress
        ? {
            status: stream.egress.status,
            workerId: stream.egress.workerId,
            playbackUrl: stream.egress.playbackUrl,
            hlsReadyAt: stream.egress.hlsReadyAt?.toISOString() ?? null,
            lastSegmentAt: stream.egress.lastSegmentAt?.toISOString() ?? null,
            lastError: stream.egress.lastError,
            startedAt: stream.egress.startedAt?.toISOString() ?? null,
            stoppedAt: stream.egress.stoppedAt?.toISOString() ?? null,
          }
        : null,
    };
  }
}
