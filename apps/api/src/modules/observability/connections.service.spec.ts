import { ConnectionState, ErrorCategory } from '../../generated/prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotFoundError } from '../../shared/errors/app-error';
import { DashboardEventsService } from '../dashboard-ws/realtime/dashboard-events.service';
import { VerifiedRtcToken } from '../signaling/authentication/rtc-token-verifier.service';
import { ConnectionsService } from './connections.service';
import { Environment } from '../../shared/environment/environment.constants';

const grant = {
  join: true,
  subscribe: true,
  publish: true,
  publishAudio: true,
  publishVideo: true,
  publishData: false,
};

const ctx: VerifiedRtcToken = {
  tokenId: 'rtc-token-1',
  participantId: 'alice',
  projectId: 'project-1',
  environment: Environment.DEVELOPMENT,
  roomId: 'room-1',
  roomName: 'demo-room',
  permissions: grant,
  grant,
  expiresAt: new Date(),
};

describe('ConnectionsService', () => {
  let service: ConnectionsService;
  let prisma: {
    connection: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock; findMany: jest.Mock };
    connectionEvent: { create: jest.Mock };
    errorEvent: { create: jest.Mock };
  };
  let dashboardEvents: { publish: jest.Mock };

  beforeEach(() => {
    prisma = {
      connection: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), findMany: jest.fn() },
      connectionEvent: { create: jest.fn() },
      errorEvent: { create: jest.fn() },
    };
    dashboardEvents = { publish: jest.fn().mockResolvedValue(undefined) };
    service = new ConnectionsService(
      prisma as unknown as PrismaService,
      dashboardEvents as unknown as DashboardEventsService,
    );
  });

  describe('recordEvent — connection lifecycle', () => {
    it('creates a new Connection row on the first event for an unseen connectionId', async () => {
      prisma.connection.findUnique.mockResolvedValue(null);
      prisma.connection.create.mockResolvedValue({ id: 'row-1', publicId: 'conn_abc' });

      await service.recordEvent(ctx, { connectionId: 'conn_abc', type: 'connection_started' });

      expect(prisma.connection.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          publicId: 'conn_abc',
          projectId: 'project-1',
          roomId: 'room-1',
          roomName: 'demo-room',
          participantIdentity: 'alice',
          state: ConnectionState.CONNECTING,
        }),
      });
      expect(prisma.connectionEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ connectionId: 'row-1', type: 'connection_started' }),
      });
    });

    it('sets connectedAt only the first time a connected event arrives', async () => {
      const connectedAt = new Date('2026-01-01T00:00:00.000Z');
      prisma.connection.findUnique.mockResolvedValue({ id: 'row-1', connectedAt, reconnectCount: 0 });
      prisma.connection.update.mockResolvedValue({ id: 'row-1' });

      await service.recordEvent(ctx, { connectionId: 'conn_abc', type: 'connected' });

      const updateArg = prisma.connection.update.mock.calls[0][0];
      expect(updateArg.data.connectedAt).toBeUndefined();
      expect(updateArg.data.state).toBe(ConnectionState.CONNECTED);
    });

    it('increments reconnectCount on a reconnecting event', async () => {
      prisma.connection.findUnique.mockResolvedValue({ id: 'row-1', reconnectCount: 2 });
      prisma.connection.update.mockResolvedValue({ id: 'row-1' });

      await service.recordEvent(ctx, { connectionId: 'conn_abc', type: 'reconnecting' });

      expect(prisma.connection.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ reconnectCount: 3, state: ConnectionState.RECONNECTING }),
        }),
      );
    });

    it('computes durationMs from connectedAt to disconnectedAt', async () => {
      const connectedAt = new Date('2026-01-01T00:00:00.000Z');
      prisma.connection.findUnique.mockResolvedValue({ id: 'row-1', connectedAt, reconnectCount: 0 });
      prisma.connection.update.mockResolvedValue({ id: 'row-1' });

      await service.recordEvent(ctx, {
        connectionId: 'conn_abc',
        type: 'disconnected',
        timestamp: '2026-01-01T00:00:05.000Z',
      });

      expect(prisma.connection.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ durationMs: 5000, state: ConnectionState.DISCONNECTED }),
        }),
      );
    });

    it('records an error row classified from the event data, linked to the connection', async () => {
      prisma.connection.findUnique.mockResolvedValue({ id: 'row-1', reconnectCount: 0 });
      prisma.connection.update.mockResolvedValue({ id: 'row-1' });

      await service.recordEvent(ctx, {
        connectionId: 'conn_abc',
        type: 'error',
        data: { code: 'TOKEN_EXPIRED', message: 'RTC token has expired' },
      });

      expect(prisma.errorEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          projectId: 'project-1',
          connectionId: 'row-1',
          category: ErrorCategory.TOKEN_ERROR,
          message: 'RTC token has expired',
        }),
      });
    });

    it('never lets undefined metadata overwrite existing fields on update', async () => {
      prisma.connection.findUnique.mockResolvedValue({ id: 'row-1', reconnectCount: 0, sdkVersion: '0.1.0' });
      prisma.connection.update.mockResolvedValue({ id: 'row-1' });

      await service.recordEvent(ctx, { connectionId: 'conn_abc', type: 'ice_state_changed', data: {} });

      const updateArg = prisma.connection.update.mock.calls[0][0];
      expect('sdkVersion' in updateArg.data).toBe(false);
    });
  });

  describe('recordEvent — stats', () => {
    function statsEvent(data: Record<string, unknown>) {
      return service.recordEvent(ctx, { connectionId: 'conn_abc', type: 'stats', data });
    }

    beforeEach(() => {
      prisma.connection.findUnique.mockResolvedValue({ id: 'row-1', reconnectCount: 0 });
      prisma.connection.update.mockResolvedValue({ id: 'row-1' });
    });

    it('stores the connection quality reported alongside the tracks', async () => {
      await statsEvent({ connectionQuality: 'poor', local: [], remote: [] });

      expect(prisma.connection.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ connectionQuality: 'poor' }) }),
      );
    });

    it('takes RTT from a send-direction track — the only direction WebRTC ever reports it for', async () => {
      await statsEvent({
        local: [{ direction: 'send', roundTripTimeMs: 84.4 }],
        remote: [{ direction: 'receive', roundTripTimeMs: 999 }],
      });

      const { data } = prisma.connection.update.mock.calls[0][0];
      expect(data.rttMs).toBe(84); // rounded, and from local — not the bogus remote value
    });

    it('takes the worst jitter across every track, not the first or the average', async () => {
      await statsEvent({
        local: [{ jitterMs: 5 }],
        remote: [{ jitterMs: 40 }, { jitterMs: 12 }],
      });

      const { data } = prisma.connection.update.mock.calls[0][0];
      // A support engineer skimming a connection list needs "how bad does
      // this get", not a figure a struggling track can hide inside an average.
      expect(data.jitterMs).toBe(40);
    });

    it('takes the worst packet loss across every track', async () => {
      await statsEvent({ local: [{ packetLossPercent: 1.2 }], remote: [{ packetLossPercent: 8.7 }] });

      const { data } = prisma.connection.update.mock.calls[0][0];
      expect(data.packetLossPercent).toBe(8.7);
    });

    it('sums bitrate across every track, both directions', async () => {
      await statsEvent({
        local: [{ bitrateBps: 32_000 }],
        remote: [{ bitrateBps: 800_000 }, { bitrateBps: 50_000 }],
      });

      const { data } = prisma.connection.update.mock.calls[0][0];
      expect(data.bitrateBps).toBe(882_000);
    });

    it('takes codec from a remote track — mimeType is a receive-direction-only WebRTC stat', async () => {
      await statsEvent({
        local: [{ codec: 'should-never-appear' }],
        remote: [{ codec: 'video/VP8' }],
      });

      const { data } = prisma.connection.update.mock.calls[0][0];
      expect(data.codec).toBe('video/VP8');
    });

    it('omits every stats field rather than writing nulls when local/remote are both empty', async () => {
      await statsEvent({ local: [], remote: [] });

      const { data } = prisma.connection.update.mock.calls[0][0];
      expect('rttMs' in data).toBe(false);
      expect('jitterMs' in data).toBe(false);
      expect('bitrateBps' in data).toBe(false);
      expect('codec' in data).toBe(false);
    });

    it('tolerates a malformed payload rather than throwing', async () => {
      // Telemetry is best-effort and the wire payload is caller-supplied;
      // a shape that doesn't match must degrade to "nothing extracted",
      // not crash the ingest endpoint for every other event in flight.
      await expect(statsEvent({ local: 'not-an-array', remote: null, connectionQuality: 42 })).resolves.toBeUndefined();

      const { data } = prisma.connection.update.mock.calls[0][0];
      expect('connectionQuality' in data).toBe(false);
    });

    it('never lets a stats event drive the connection lifecycle state', async () => {
      // 'stats' is metadata-only, same as ice_state_changed above: it
      // must not appear in the state-transition switch.
      await statsEvent({ local: [], remote: [] });

      const { data } = prisma.connection.update.mock.calls[0][0];
      expect('state' in data).toBe(false);
    });
  });

  describe('dashboard realtime nudges (Phase 5C)', () => {
    it('publishes connection.state_changed on a real lifecycle transition, scoped to the connection\'s project', async () => {
      prisma.connection.findUnique.mockResolvedValue(null);
      prisma.connection.create.mockResolvedValue({
        id: 'row-1',
        publicId: 'conn_abc',
        roomId: 'room-1',
        state: ConnectionState.CONNECTING,
      });

      await service.recordEvent(ctx, { connectionId: 'conn_abc', type: 'connection_started' });

      // Scoped to ctx.projectId — the same project the connection itself
      // belongs to, never a client-suppliable value (ConnectionsService
      // only ever sees ctx.projectId, resolved server-side from the
      // verified RTC token).
      expect(dashboardEvents.publish).toHaveBeenCalledWith('project-1', {
        type: 'connection.state_changed',
        connectionId: 'conn_abc',
        roomId: 'room-1',
        state: ConnectionState.CONNECTING,
      });
    });

    it('never sends the full connection record — only connectionId, roomId, and state', async () => {
      prisma.connection.findUnique.mockResolvedValue(null);
      prisma.connection.create.mockResolvedValue({
        id: 'row-1',
        publicId: 'conn_abc',
        roomId: 'room-1',
        roomName: 'demo-room',
        participantIdentity: 'alice',
        state: ConnectionState.CONNECTING,
        sdkVersion: '1.2.3',
        platform: 'web',
      });

      await service.recordEvent(ctx, { connectionId: 'conn_abc', type: 'connection_started' });

      const [, payload] = dashboardEvents.publish.mock.calls[0];
      expect(Object.keys(payload).sort()).toEqual(['connectionId', 'roomId', 'state', 'type']);
    });

    it('does not publish for a stats event — the high-frequency, bursty one that never moves lifecycle state', async () => {
      prisma.connection.findUnique.mockResolvedValue({ id: 'row-1', reconnectCount: 0, state: ConnectionState.CONNECTED });
      prisma.connection.update.mockResolvedValue({ id: 'row-1', state: ConnectionState.CONNECTED });

      await service.recordEvent(ctx, {
        connectionId: 'conn_abc',
        type: 'stats',
        data: { connectionQuality: 'good', local: [], remote: [] },
      });

      expect(dashboardEvents.publish).not.toHaveBeenCalled();
    });

    it('does not publish when the reported state is unchanged from the existing row — a duplicate/replayed event', async () => {
      prisma.connection.findUnique.mockResolvedValue({ id: 'row-1', reconnectCount: 0, state: ConnectionState.CONNECTED });
      prisma.connection.update.mockResolvedValue({
        id: 'row-1',
        publicId: 'conn_abc',
        roomId: 'room-1',
        state: ConnectionState.CONNECTED,
      });

      // A second 'connected' event for a connection already CONNECTED —
      // telemetry has no delivery guarantee (connections.service.ts's own
      // docs), so this is a realistic replay, not a hypothetical.
      await service.recordEvent(ctx, { connectionId: 'conn_abc', type: 'connected' });

      expect(dashboardEvents.publish).not.toHaveBeenCalled();
    });

    it('does not publish for a metadata-only event with no lifecycle-state field at all', async () => {
      prisma.connection.findUnique.mockResolvedValue({ id: 'row-1', reconnectCount: 0 });
      prisma.connection.update.mockResolvedValue({ id: 'row-1' });

      await service.recordEvent(ctx, { connectionId: 'conn_abc', type: 'ice_state_changed', data: {} });

      expect(dashboardEvents.publish).not.toHaveBeenCalled();
    });

    it('does publish when the state genuinely changes on an existing row', async () => {
      prisma.connection.findUnique.mockResolvedValue({ id: 'row-1', reconnectCount: 0, state: ConnectionState.CONNECTING });
      prisma.connection.update.mockResolvedValue({
        id: 'row-1',
        publicId: 'conn_abc',
        roomId: 'room-1',
        state: ConnectionState.CONNECTED,
      });

      await service.recordEvent(ctx, { connectionId: 'conn_abc', type: 'connected' });

      expect(dashboardEvents.publish).toHaveBeenCalledWith(
        'project-1',
        expect.objectContaining({ type: 'connection.state_changed', state: ConnectionState.CONNECTED }),
      );
    });

    it('does not wait on the publish before resolving — fire-and-forget, so a slow Redis never delays telemetry ingest', async () => {
      let releasePublish!: () => void;
      dashboardEvents.publish.mockReturnValue(new Promise<void>((resolve) => (releasePublish = resolve)));
      prisma.connection.findUnique.mockResolvedValue(null);
      prisma.connection.create.mockResolvedValue({
        id: 'row-1',
        publicId: 'conn_abc',
        roomId: 'room-1',
        state: ConnectionState.CONNECTING,
      });

      // recordEvent() resolves even though the publish() promise it fired
      // (via `void`) is still pending — proving the ingest path never
      // awaits it. DashboardEventsService.publish() itself never rejects
      // in production (it logs and swallows Redis errors internally), so
      // nothing here needs to release the pending promise.
      await expect(
        service.recordEvent(ctx, { connectionId: 'conn_abc', type: 'connection_started' }),
      ).resolves.toBeUndefined();

      releasePublish();
    });
  });

  describe('getDetail', () => {
    it('throws NotFoundError when the connection belongs to a different project', async () => {
      const findMock = jest.fn().mockResolvedValue({ publicId: 'conn_abc', projectId: 'other-project' });
      (prisma.connection as unknown as { findUnique: jest.Mock }).findUnique = findMock;

      await expect(service.getDetail('project-1', 'conn_abc')).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('listForProject — the published, server-SDK-facing shape', () => {
    it('returns a bare array — @ravenkash/server and livqeno-sdk both type this as ConnectionSummary[]', async () => {
      const rows = [{ publicId: 'conn_1' }, { publicId: 'conn_2' }];
      prisma.connection.findMany.mockResolvedValue(rows);

      const result = await service.listForProject('project-1', { limit: 50 } as never);

      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual(rows);
      expect(prisma.connection.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'desc' }, take: 50 }),
      );
    });

    it('never receives a cursor argument — it has no pagination of its own', async () => {
      prisma.connection.findMany.mockResolvedValue([]);

      await service.listForProject('project-1', { limit: 50, cursor: 'conn_ignored' } as never);

      const call = prisma.connection.findMany.mock.calls[0][0];
      expect('cursor' in call).toBe(false);
      expect('skip' in call).toBe(false);
    });
  });

  describe('listForProjectPaginated — the dashboard-only cursor-paginated shape', () => {
    function row(publicId: string) {
      return { publicId };
    }

    it('requests one extra row and reports hasMore true when a next page exists', async () => {
      prisma.connection.findMany.mockResolvedValue([row('c1'), row('c2'), row('c3')]); // limit 2 + 1 extra

      const result = await service.listForProjectPaginated('project-1', { limit: 2 } as never);

      expect(result.data).toHaveLength(2);
      expect(result.data.map((c) => c.publicId)).toEqual(['c1', 'c2']);
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBe('c2'); // the last row actually returned, not the trimmed extra
    });

    it('reports hasMore false and nextCursor null at the end of the dataset', async () => {
      prisma.connection.findMany.mockResolvedValue([row('c1'), row('c2')]); // fewer than limit + 1

      const result = await service.listForProjectPaginated('project-1', { limit: 5 } as never);

      expect(result.data).toHaveLength(2);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
    });

    it('passes no cursor on the first page', async () => {
      prisma.connection.findMany.mockResolvedValue([]);

      await service.listForProjectPaginated('project-1', { limit: 50 } as never);

      const call = prisma.connection.findMany.mock.calls[0][0];
      expect('cursor' in call).toBe(false);
      expect('skip' in call).toBe(false);
    });

    it('cursors on the given page by publicId and skips the cursor row itself', async () => {
      prisma.connection.findMany.mockResolvedValue([]);

      await service.listForProjectPaginated('project-1', { limit: 50, cursor: 'conn_last' } as never);

      const call = prisma.connection.findMany.mock.calls[0][0];
      expect(call.cursor).toEqual({ publicId: 'conn_last' });
      expect(call.skip).toBe(1);
    });

    it('orders by createdAt desc with publicId desc as a deterministic tiebreak', async () => {
      prisma.connection.findMany.mockResolvedValue([]);

      await service.listForProjectPaginated('project-1', { limit: 50 } as never);

      const call = prisma.connection.findMany.mock.calls[0][0];
      expect(call.orderBy).toEqual([{ createdAt: 'desc' }, { publicId: 'desc' }]);
    });

    it('still applies state and roomId filters, same as the unpaginated method', async () => {
      prisma.connection.findMany.mockResolvedValue([]);

      await service.listForProjectPaginated('project-1', {
        limit: 50,
        state: 'CONNECTED',
        roomId: 'room-9',
      } as never);

      const call = prisma.connection.findMany.mock.calls[0][0];
      expect(call.where).toEqual(expect.objectContaining({ state: 'CONNECTED', roomId: 'room-9' }));
    });
  });
});
