import { ConnectionState, ErrorCategory } from '../../generated/prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotFoundError } from '../../shared/errors/app-error';
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

  beforeEach(() => {
    prisma = {
      connection: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), findMany: jest.fn() },
      connectionEvent: { create: jest.fn() },
      errorEvent: { create: jest.fn() },
    };
    service = new ConnectionsService(prisma as unknown as PrismaService);
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
        expect.objectContaining({ data: expect.objectContaining({ reconnectCount: 3, state: ConnectionState.RECONNECTING }) }),
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
        expect.objectContaining({ data: expect.objectContaining({ durationMs: 5000, state: ConnectionState.DISCONNECTED }) }),
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
      // Telemetry is best-effort and the wire payload is caller-supplied —
      // a shape that doesn't match must degrade to "nothing extracted",
      // not crash the ingest endpoint for every other event in flight.
      await expect(
        statsEvent({ local: 'not-an-array', remote: null, connectionQuality: 42 }),
      ).resolves.toBeUndefined();

      const { data } = prisma.connection.update.mock.calls[0][0];
      expect('connectionQuality' in data).toBe(false);
    });

    it('never lets a stats event drive the connection lifecycle state', async () => {
      // 'stats' is metadata-only, same as ice_state_changed above — it
      // must not appear in the state-transition switch.
      await statsEvent({ local: [], remote: [] });

      const { data } = prisma.connection.update.mock.calls[0][0];
      expect('state' in data).toBe(false);
    });
  });

  describe('getDetail', () => {
    it('throws NotFoundError when the connection belongs to a different project', async () => {
      const findMock = jest.fn().mockResolvedValue({ publicId: 'conn_abc', projectId: 'other-project' });
      (prisma.connection as unknown as { findUnique: jest.Mock }).findUnique = findMock;

      await expect(service.getDetail('project-1', 'conn_abc')).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
