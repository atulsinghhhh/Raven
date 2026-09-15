import { Injectable } from '@nestjs/common';
import { Connection, ConnectionState, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotFoundError } from '../../shared/errors/app-error';
import { generateId } from '../../shared/utils/crypto.util';
import { DashboardWsEventType } from '../dashboard-ws/dashboard-ws-events';
import { DashboardEventsService } from '../dashboard-ws/realtime/dashboard-events.service';
import { VerifiedRtcToken } from '../signaling/authentication/rtc-token-verifier.service';
import { classifyError } from './error-classifier';
import { IngestEventDto } from './dto/ingest-event.dto';
import { QueryConnectionsDto } from './dto/query-connections.dto';

type ConnectionPatch = Partial<{
  state: ConnectionState;
  startedAt: Date;
  connectedAt: Date;
  disconnectedAt: Date;
  disconnectReason: string;
  durationMs: number;
  sdkVersion: string;
  platform: string;
  browser: string;
  networkType: string;
  region: string;
  iceConnectionState: string;
  signalingState: string;
  connectionQuality: string;
  rttMs: number;
  jitterMs: number;
  packetLossPercent: number;
  bitrateBps: number;
  codec: string;
}>;

/**
 * Turns one 'stats' telemetry event, which is `Room.getConnectionStats()` on
 * the wire (see @ravenkash/rtc), into the subset of `ConnectionPatch` it can
 * fill in.
 *
 * Every other event type's `data` object simply lacks this shape, so merging
 * it in unconditionally at the call site is safe: there's nothing to
 * extract and this returns an empty patch.
 *
 * Several tracks collapse into one connection-level number per field, since
 * Connection is one row per participant instead of per track:
 *
 * - `rttMs`: the first send-direction reading. WebRTC never reports a
 *   receiver's own round-trip time, so that's the only direction it can
 *   honestly come from.
 * - `jitterMs` and `packetLossPercent`: the worst reading across every
 *   track. For a support engineer skimming a connection list, "how bad does
 *   this get" beats an average that hides one struggling track.
 * - `bitrateBps`: the sum across every track. Total throughput over the
 *   connection, both directions.
 * - `codec`: taken from a remote, receive-direction track. `mimeType` is a
 *   receive-direction-video-only WebRTC stat, so a local or send entry never
 *   carries one. See `track-stats.ts` on the SDK side.
 */
function extractStatsPatch(data: Record<string, unknown>): Partial<ConnectionPatch> {
  const asTrackList = (value: unknown): Record<string, unknown>[] =>
    Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  const local = asTrackList(data.local);
  const remote = asTrackList(data.remote);
  const allTracks = [...local, ...remote];
  const num = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined;

  const patch: Partial<ConnectionPatch> = {};

  if (typeof data.connectionQuality === 'string') {
    patch.connectionQuality = data.connectionQuality;
  }

  const rtt = local.map((track) => num(track.roundTripTimeMs)).find((value) => value !== undefined);
  if (rtt !== undefined) {
    patch.rttMs = Math.round(rtt);
  }

  const jitterValues = allTracks
    .map((track) => num(track.jitterMs))
    .filter((value): value is number => value !== undefined);
  if (jitterValues.length > 0) {
    patch.jitterMs = Math.round(Math.max(...jitterValues));
  }

  const lossValues = allTracks
    .map((track) => num(track.packetLossPercent))
    .filter((value): value is number => value !== undefined);
  if (lossValues.length > 0) {
    patch.packetLossPercent = Math.max(...lossValues);
  }

  const bitrateValues = allTracks
    .map((track) => num(track.bitrateBps))
    .filter((value): value is number => value !== undefined);
  if (bitrateValues.length > 0) {
    patch.bitrateBps = Math.round(bitrateValues.reduce((sum, value) => sum + value, 0));
  }

  const codec = remote
    .map((track) => (typeof track.codec === 'string' ? track.codec : undefined))
    .find((value) => value !== undefined);
  if (codec !== undefined) {
    patch.codec = codec;
  }

  return patch;
}

/**
 * Event-sources the `Connection`, `ConnectionEvent` and `ErrorEvent` tables
 * from best-effort telemetry POSTed by `@ravenkash/rtc` (Phase 9).
 *
 * One connection row per `conn_...` ID, upserted as its events arrive.
 * There's no guarantee of delivery or ordering; telemetry is fire-and-forget
 * by design (docs/telemetry.md#reliability). So every branch in here is
 * written to cope with a missing "connection_started" or events turning up
 * out of order, rather than assume a clean lifecycle.
 */
@Injectable()
export class ConnectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dashboardEvents: DashboardEventsService,
  ) {}

  async recordEvent(ctx: VerifiedRtcToken, dto: IngestEventDto): Promise<void> {
    const timestamp = dto.timestamp ? new Date(dto.timestamp) : new Date();
    const data = dto.data ?? {};

    const connection = await this.upsertConnection(ctx, dto.connectionId, dto.type, data, timestamp);

    await this.prisma.connectionEvent.create({
      data: {
        connectionId: connection.id,
        type: dto.type,
        data: data as Prisma.InputJsonValue,
        timestamp,
      },
    });

    if (dto.type === 'error') {
      await this.recordError(ctx, connection.id, data);
    }
  }

  private async upsertConnection(
    ctx: VerifiedRtcToken,
    publicId: string,
    type: string,
    data: Record<string, unknown>,
    timestamp: Date,
  ): Promise<Connection> {
    const existing = await this.prisma.connection.findUnique({ where: { publicId } });

    const patch: ConnectionPatch = {};
    const str = (key: string): string | undefined =>
      typeof data[key] === 'string' ? (data[key] as string) : undefined;

    patch.sdkVersion = str('sdkVersion');
    patch.platform = str('platform');
    patch.browser = str('browser');
    patch.networkType = str('networkType');
    patch.region = str('region');
    patch.iceConnectionState = str('iceConnectionState');
    patch.signalingState = str('signalingState');

    // Only ever populated by a 'stats' event. Every other event type's
    // `data` simply lacks these keys, so this merges in cleanly next to the
    // unconditional metadata fields above with no check on `type`.
    Object.assign(patch, extractStatsPatch(data));

    let reconnectDelta = 0;

    switch (type) {
      case 'connection_started':
        patch.state = ConnectionState.CONNECTING;
        patch.startedAt = timestamp;
        break;
      case 'connected':
        patch.state = ConnectionState.CONNECTED;
        if (!existing?.connectedAt) patch.connectedAt = timestamp;
        break;
      case 'reconnecting':
        patch.state = ConnectionState.RECONNECTING;
        reconnectDelta = 1;
        break;
      case 'reconnected':
        patch.state = ConnectionState.CONNECTED;
        break;
      case 'disconnected':
        patch.state = ConnectionState.DISCONNECTED;
        patch.disconnectedAt = timestamp;
        patch.disconnectReason = str('reason');
        break;
      case 'connection_failed':
        patch.state = ConnectionState.FAILED;
        patch.disconnectedAt = timestamp;
        break;
      default:
        // Metadata-only, participant and track events don't move lifecycle
        // state.
        break;
    }

    if (type === 'disconnected' || type === 'connection_failed') {
      const start = existing?.connectedAt ?? existing?.startedAt ?? timestamp;
      patch.durationMs = Math.max(0, timestamp.getTime() - new Date(start).getTime());
    }

    // Strip undefined keys, so a Prisma update doesn't overwrite existing
    // values with `undefined`. Prisma treats an explicit `undefined` as
    // "leave unset" reliably for `create` only, not for spread objects.
    const cleanPatch = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));

    const connection = existing
      ? await this.prisma.connection.update({
          where: { id: existing.id },
          data: { ...cleanPatch, reconnectCount: existing.reconnectCount + reconnectDelta },
        })
      : await this.prisma.connection.create({
          data: {
            publicId,
            projectId: ctx.projectId,
            environment: ctx.environment,
            roomId: ctx.roomId,
            roomName: ctx.roomName,
            participantIdentity: ctx.participantId,
            reconnectCount: reconnectDelta,
            ...cleanPatch,
          },
        });

    // A nudge, not a snapshot (Phase 5A's approved model): the dashboard
    // refetches the authoritative record over REST, this only tells it
    // to. Published only when the lifecycle state actually moved —
    // 'stats' events (the high-frequency, bursty ones: one per
    // participant every ~5s) never set patch.state, so they never reach
    // here. That is what keeps this from flooding the dashboard channel
    // with every telemetry mutation (Phase 5A §12/§7).
    if (patch.state !== undefined && patch.state !== existing?.state) {
      void this.dashboardEvents.publish(ctx.projectId, {
        type: DashboardWsEventType.ConnectionStateChanged,
        connectionId: connection.publicId,
        roomId: connection.roomId,
        state: connection.state,
      });
    }

    return connection;
  }

  private async recordError(
    ctx: VerifiedRtcToken,
    connectionRowId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const str = (key: string): string | undefined =>
      typeof data[key] === 'string' ? (data[key] as string) : undefined;
    const classification = classifyError({
      code: str('code'),
      message: str('message'),
      iceConnectionState: str('iceConnectionState'),
      signalingState: str('signalingState'),
      hint: str('hint'),
    });

    await this.prisma.errorEvent.create({
      data: {
        publicId: generateId('err'),
        projectId: ctx.projectId,
        environment: ctx.environment,
        connectionId: connectionRowId,
        roomId: ctx.roomId,
        participantId: ctx.participantId,
        category: classification.category,
        message: (str('message') ?? 'Unknown error').slice(0, 500),
        likelyCause: classification.likelyCause,
        suggestedAction: classification.suggestedAction,
        sdkVersion: str('sdkVersion'),
        platform: str('platform'),
      },
    });
  }

  /**
   * `GET /v1/connections` — the server-SDK-facing endpoint
   * (api-observability.controller.ts), published and depended on by
   * `@ravenkash/server`'s and `livqeno-sdk`'s `connections.list()`, both
   * typed as returning a bare array. This method's return shape is
   * therefore a public contract and must not change — pagination for the
   * dashboard is a separate method below, not a variant of this one.
   */
  async listForProject(projectId: string, query: QueryConnectionsDto): Promise<Connection[]> {
    return this.prisma.connection.findMany({
      where: {
        projectId,
        ...(query.state ? { state: query.state } : {}),
        ...(query.roomId ? { roomId: query.roomId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
    });
  }

  /**
   * The dashboard's own connections list (dashboard-observability.controller.ts
   * only) — cursor-paginated by `publicId`, never the internal database id
   * (same rule as everywhere else in this service). `createdAt desc` alone
   * isn't a stable sort: telemetry can write several connections in the
   * same millisecond under load, and Prisma's cursor pagination needs a
   * genuinely total order to avoid re-showing or skipping a row at the
   * page boundary. `publicId desc` as the tiebreak makes the order (and
   * therefore the cursor) deterministic.
   *
   * Fetches one extra row to learn `hasMore` without a second `count`
   * query, then trims it back off before returning. Unlike
   * `listForProject`, free to evolve: the dashboard frontend is the only
   * caller, updated in the same change as this method.
   */
  async listForProjectPaginated(
    projectId: string,
    query: QueryConnectionsDto,
  ): Promise<{ data: Connection[]; nextCursor: string | null; hasMore: boolean }> {
    const rows = await this.prisma.connection.findMany({
      where: {
        projectId,
        ...(query.state ? { state: query.state } : {}),
        ...(query.roomId ? { roomId: query.roomId } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { publicId: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { publicId: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > query.limit;
    const data = hasMore ? rows.slice(0, query.limit) : rows;
    const nextCursor = hasMore ? data[data.length - 1].publicId : null;

    return { data, nextCursor, hasMore };
  }

  async getDetail(projectId: string, publicId: string) {
    const connection = await this.prisma.connection.findUnique({
      where: { publicId },
      include: {
        events: { orderBy: { timestamp: 'asc' } },
        errors: { orderBy: { timestamp: 'asc' } },
      },
    });

    if (!connection || connection.projectId !== projectId) {
      throw new NotFoundError('Connection');
    }

    // `ErrorEvent.connectionId` is an internal database uuid FK. Every ID a
    // developer sees has to be the public `conn_...` one (Phase 9 spec §9),
    // and for these embedded errors that's trivially this connection's own
    // publicId.
    return {
      ...connection,
      errors: connection.errors.map((error) => ({ ...error, connectionId: connection.publicId })),
    };
  }

  /** Connections in a non-terminal state. This is what "active" counts are built on. */
  async findActive(projectId?: string): Promise<Pick<Connection, 'roomId' | 'participantIdentity' | 'projectId'>[]> {
    return this.prisma.connection.findMany({
      where: {
        ...(projectId ? { projectId } : {}),
        state: { in: [ConnectionState.CONNECTING, ConnectionState.CONNECTED, ConnectionState.RECONNECTING] },
      },
      select: { roomId: true, participantIdentity: true, projectId: true },
    });
  }
}
