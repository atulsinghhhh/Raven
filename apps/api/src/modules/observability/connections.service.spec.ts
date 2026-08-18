import { ConnectionState, ErrorCategory } from '../../generated/prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotFoundError } from '../../shared/errors/app-error';
import { VerifiedRtcToken } from '../signaling/authentication/rtc-token-verifier.service';
import { ConnectionsService } from './connections.service';

const ctx: VerifiedRtcToken = {
  participantId: 'alice',
  projectId: 'project-1',
  roomId: 'room-1',
  roomName: 'demo-room',
  permissions: { join: true, subscribe: true, publish: true, publishAudio: true, publishVideo: true, publishData: false },
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

  describe('getDetail', () => {
    it('throws NotFoundError when the connection belongs to a different project', async () => {
      const findMock = jest.fn().mockResolvedValue({ publicId: 'conn_abc', projectId: 'other-project' });
      (prisma.connection as unknown as { findUnique: jest.Mock }).findUnique = findMock;

      await expect(service.getDetail('project-1', 'conn_abc')).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
