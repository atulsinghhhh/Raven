import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LiveStream, LiveStreamEgressStatus } from '../../../generated/prisma/client';
import { PrismaService } from '../../../shared/database/prisma.service';
import { ProjectScope } from '../../../shared/environment/environment.constants';
import { RtcTokensService } from '../../rtc-tokens/rtc-tokens.service';
import { WebhookEventsService } from '../../webhooks/webhook-events.service';

/**
 * Identity prefix reserved for the egress worker's own room join. A
 * BROADCAST-mode stream's egress worker joins the RTC room exactly like any
 * other viewer would (same `mintRawCredential` call, `publish:false`) — see
 * docs/architecture/cdn-hls-egress-scope.md's Option B analysis for why
 * this reuses the existing join path instead of touching the SFU's core
 * media path. But it is internal infrastructure, not public audience
 * traffic, so every place Live Streaming counts viewers must exclude it —
 * the same "real participant, never counted as public traffic" precedent
 * `ChatActor.internal` already sets for the system chat message.
 */
const EGRESS_IDENTITY_PREFIX = 'egress-';

export function egressIdentityFor(streamPublicId: string): string {
  return `${EGRESS_IDENTITY_PREFIX}${streamPublicId}`;
}

export function isEgressIdentity(identity: string): boolean {
  return identity.startsWith(EGRESS_IDENTITY_PREFIX);
}

/** Reported by the egress worker's heartbeat, POSTed to this API's internal endpoint. */
export interface EgressHeartbeatPayload {
  /** The stream's public id (`stream_...`), not the internal uuid — the worker only ever sees the public id, via the start request. */
  streamId: string;
  workerId: string;
  hostConnected: boolean;
  ffmpegAlive: boolean;
  /** Whether a real fetch against the public CDN URL succeeded — not just "did the upload call succeed". */
  manifestReachable: boolean;
  playbackUrl?: string;
  /** Set only when the worker has given up — ffmpeg crashed, upload failed repeatedly, etc. */
  error?: string;
}

/**
 * The API's side of the egress-worker control plane: starts/stops a
 * worker's run for a BROADCAST-mode stream, and records its heartbeats
 * onto `LiveStreamEgress`.
 *
 * Deliberately thin. This service never touches ffmpeg, HLS, or Azure Blob
 * — that's all inside `services/egress-worker`, reached only over its
 * small internal HTTP API (start/stop) and its inbound heartbeat. Nothing
 * here assumes what storage/CDN the worker actually uses.
 */
@Injectable()
export class EgressControlService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EgressControlService.name);
  private staleSweepTimer?: NodeJS.Timeout;
  private static readonly REQUEST_TIMEOUT_MS = 10_000;
  private static readonly STALE_SWEEP_INTERVAL_MS = 10_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly rtcTokensService: RtcTokensService,
    private readonly webhooks: WebhookEventsService,
  ) {}

  onModuleInit(): void {
    this.staleSweepTimer = setInterval(() => void this.sweepStale(), EgressControlService.STALE_SWEEP_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.staleSweepTimer) clearInterval(this.staleSweepTimer);
  }

  /**
   * Called (fire-and-forget) from `LiveStreamsService.start()` for
   * BROADCAST-mode streams only. Never throws — every failure path marks
   * the egress FAILED and emits `live_stream.egress_failed` instead, so a
   * caller learns of it through the same webhook channel it would use to
   * learn of a mid-stream failure, not through a different mechanism for
   * "never came up" versus "came up then died".
   */
  async start(scope: ProjectScope, stream: LiveStream): Promise<void> {
    await this.prisma.liveStreamEgress.upsert({
      where: { streamId: stream.id },
      create: { streamId: stream.id, status: LiveStreamEgressStatus.STARTING, startedAt: new Date() },
      update: {
        status: LiveStreamEgressStatus.STARTING,
        startedAt: new Date(),
        stoppedAt: null,
        lastError: null,
      },
    });

    const baseUrl = this.configService.get<string>('egress.workerBaseUrl');
    const secret = this.configService.get<string>('egress.workerSharedSecret');
    if (!baseUrl || !secret) {
      await this.fail(scope, stream, 'egress worker not configured (EGRESS_WORKER_BASE_URL/EGRESS_WORKER_SHARED_SECRET unset)');
      return;
    }

    try {
      // Not RtcTokensService.create(): same reasoning as every other Live
      // Streaming credential — never gated by the RTC allowance, and this
      // one is never gated by anything at all, since it isn't developer
      // traffic. publish:false, same as a real viewer, so the worker has
      // exactly a real viewer's media access and no more.
      const credential = await this.rtcTokensService.mintRawCredential(scope, stream.roomId, {
        participantIdentity: egressIdentityFor(stream.publicId),
        permissions: {
          join: true,
          subscribe: true,
          publish: false,
          publishAudio: false,
          publishVideo: false,
          publishData: false,
        },
      });

      await this.callWorker(baseUrl, secret, '/internal/egress/start', {
        streamId: stream.publicId,
        roomId: stream.roomId,
        rtcToken: credential.token,
        rtcEndpoint: credential.endpoint,
        iceServers: credential.iceServers,
      });
    } catch (err) {
      await this.fail(scope, stream, err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Called (awaited, but never throwing) from `LiveStreamsService.end()`
   * for BROADCAST-mode streams that had egress running. By the time this
   * runs, `roomsService.close()` has already torn down the host's RTC
   * session — an unreachable worker here is a graceful-drain problem, not
   * a correctness one, so this always leaves the row `STOPPED` rather than
   * risking it stuck in `STOPPING` forever.
   */
  async stop(scope: ProjectScope, stream: LiveStream): Promise<void> {
    const egress = await this.prisma.liveStreamEgress.findUnique({ where: { streamId: stream.id } });
    if (!egress || egress.status === LiveStreamEgressStatus.STOPPED) return;

    await this.prisma.liveStreamEgress.update({
      where: { streamId: stream.id },
      data: { status: LiveStreamEgressStatus.STOPPING },
    });

    const baseUrl = this.configService.get<string>('egress.workerBaseUrl');
    const secret = this.configService.get<string>('egress.workerSharedSecret');
    if (baseUrl && secret) {
      try {
        await this.callWorker(baseUrl, secret, '/internal/egress/stop', { streamId: stream.publicId });
      } catch (err) {
        this.logger.warn(`failed to reach egress worker to stop stream ${stream.publicId}: ${(err as Error).message}`);
      }
    }

    await this.prisma.liveStreamEgress.update({
      where: { streamId: stream.id },
      data: { status: LiveStreamEgressStatus.STOPPED, stoppedAt: new Date() },
    });
  }

  /**
   * Inbound from the egress worker (via `EgressInternalController`), every
   * few seconds while it runs. The one transition that matters here is
   * "manifest just became genuinely fetchable" — that's what gates
   * `live_stream.broadcast_ready`, not merely "the worker started" or "an
   * upload succeeded" (a CDN cache/permission mistake is a distinct failure
   * mode from an upload failure; see `manifestReachable`).
   */
  async recordHeartbeat(payload: EgressHeartbeatPayload): Promise<void> {
    const stream = await this.prisma.liveStream.findUnique({ where: { publicId: payload.streamId } });
    if (!stream) return; // stale heartbeat for a stream that no longer exists — nothing to record

    const egress = await this.prisma.liveStreamEgress.findUnique({ where: { streamId: stream.id } });
    if (!egress) return; // start() never ran (or lost the race with a stop) — ignore

    const scope: ProjectScope = { projectId: stream.projectId, environment: stream.environment };

    if (payload.error) {
      await this.fail(scope, stream, payload.error);
      return;
    }

    const now = new Date();
    const wasReady = egress.status === LiveStreamEgressStatus.RUNNING;
    const nowReady = payload.manifestReachable && !!payload.playbackUrl;

    await this.prisma.liveStreamEgress.update({
      where: { streamId: stream.id },
      data: {
        workerId: payload.workerId,
        lastSegmentAt: now,
        playbackUrl: payload.playbackUrl ?? egress.playbackUrl,
        status: nowReady ? LiveStreamEgressStatus.RUNNING : egress.status,
        hlsReadyAt: nowReady && !egress.hlsReadyAt ? now : egress.hlsReadyAt,
      },
    });

    if (nowReady && !wasReady) {
      void this.webhooks.emit(scope, 'live_stream.broadcast_ready', {
        streamId: stream.publicId,
        playbackUrl: payload.playbackUrl,
        at: now.toISOString(),
      });
    }
  }

  private async callWorker(baseUrl: string, secret: string, path: string, body: Record<string, unknown>): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EgressControlService.REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`egress worker ${path} responded ${response.status}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fail(scope: ProjectScope, stream: LiveStream, reason: string): Promise<void> {
    this.logger.error(`egress failed for stream ${stream.publicId}: ${reason}`);
    await this.prisma.liveStreamEgress.upsert({
      where: { streamId: stream.id },
      create: { streamId: stream.id, status: LiveStreamEgressStatus.FAILED, lastError: reason },
      update: { status: LiveStreamEgressStatus.FAILED, lastError: reason },
    });
    void this.webhooks.emit(scope, 'live_stream.egress_failed', {
      streamId: stream.publicId,
      reason,
      at: new Date().toISOString(),
    });
  }

  /**
   * A worker that crashes outright sends no heartbeat at all — nothing
   * inbound would ever mark it FAILED without this. Mirrors
   * `LiveStreamsService.reapOverdueStreams()`'s own plain-`setInterval`
   * sweep idiom rather than adding a second scheduling dependency.
   */
  private async sweepStale(): Promise<void> {
    const thresholdMs = this.configService.get<number>('egress.staleSegmentThresholdMs')!;
    const cutoff = new Date(Date.now() - thresholdMs);

    const stale = await this.prisma.liveStreamEgress.findMany({
      where: {
        status: { in: [LiveStreamEgressStatus.STARTING, LiveStreamEgressStatus.RUNNING] },
        OR: [{ lastSegmentAt: { lt: cutoff } }, { lastSegmentAt: null, startedAt: { lt: cutoff } }],
      },
      include: { stream: true },
      take: 100,
    });

    for (const egress of stale) {
      const scope: ProjectScope = { projectId: egress.stream.projectId, environment: egress.stream.environment };
      await this.fail(scope, egress.stream, 'egress heartbeat/segment went stale');
    }
  }
}
