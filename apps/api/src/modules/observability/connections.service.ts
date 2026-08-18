import { Injectable } from '@nestjs/common';
import { Connection, ConnectionState, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotFoundError } from '../../shared/errors/app-error';
import { generateId } from '../../shared/utils/crypto.util';
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
}>;

/**
 * Event-sources the `Connection`/`ConnectionEvent`/`ErrorEvent` tables from
 * best-effort telemetry POSTed by `@raven/rtc` (Phase 9). One connection
 * row per `conn_...` ID, upserted as its events arrive — there is no
 * guarantee of delivery or ordering (telemetry is fire-and-forget by
 * design, see docs/telemetry.md#reliability), so every branch here is
 * written to tolerate a missing "connection_started" or out-of-order
 * events rather than assuming a clean lifecycle.
 */
@Injectable()
export class ConnectionsService {
  constructor(private readonly prisma: PrismaService) {}

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
    const str = (key: string): string | undefined => (typeof data[key] === 'string' ? (data[key] as string) : undefined);

    patch.sdkVersion = str('sdkVersion');
    patch.platform = str('platform');
    patch.browser = str('browser');
    patch.networkType = str('networkType');
    patch.region = str('region');
    patch.iceConnectionState = str('iceConnectionState');
    patch.signalingState = str('signalingState');

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
        // Metadata-only or participant/track events don't change lifecycle state.
        break;
    }

    if (type === 'disconnected' || type === 'connection_failed') {
      const start = existing?.connectedAt ?? existing?.startedAt ?? timestamp;
      patch.durationMs = Math.max(0, timestamp.getTime() - new Date(start).getTime());
    }

    // Strip undefined keys so a Prisma update doesn't overwrite existing
    // values with `undefined` (Prisma treats an explicit `undefined` as
    // "leave unset" only for `create`, not reliably for spread objects).
    const cleanPatch = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));

    if (existing) {
      return this.prisma.connection.update({
        where: { id: existing.id },
        data: { ...cleanPatch, reconnectCount: existing.reconnectCount + reconnectDelta },
      });
    }

    return this.prisma.connection.create({
      data: {
        publicId,
        projectId: ctx.projectId,
        roomId: ctx.roomId,
        roomName: ctx.roomName,
        participantIdentity: ctx.participantId,
        reconnectCount: reconnectDelta,
        ...cleanPatch,
      },
    });
  }

  private async recordError(
    ctx: VerifiedRtcToken,
    connectionRowId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const str = (key: string): string | undefined => (typeof data[key] === 'string' ? (data[key] as string) : undefined);
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

    // `ErrorEvent.connectionId` is an internal database uuid FK — every
    // ID shown to a developer must be the public `conn_...` one (Phase 9
    // spec §9), which for these embedded errors is trivially this same
    // connection's own publicId.
    return {
      ...connection,
      errors: connection.errors.map((error) => ({ ...error, connectionId: connection.publicId })),
    };
  }

  /** Connections currently in a non-terminal state — the basis for "active" counts. */
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
