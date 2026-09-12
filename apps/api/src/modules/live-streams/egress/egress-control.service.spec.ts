import { LiveStreamEgressStatus } from '../../../generated/prisma/client';
import { Environment } from '../../../shared/environment/environment.constants';
import { EgressControlService, egressIdentityFor, isEgressIdentity } from './egress-control.service';

/** Hand-rolled Prisma/service stubs, same style as live-streams.service.spec.ts. */
describe('EgressControlService', () => {
  let service: EgressControlService;
  let prisma: {
    liveStreamEgress: { upsert: jest.Mock; update: jest.Mock; findUnique: jest.Mock; findMany: jest.Mock };
    liveStream: { findUnique: jest.Mock };
  };
  let configService: { get: jest.Mock };
  let rtcTokensService: { mintRawCredential: jest.Mock };
  let webhooks: { emit: jest.Mock };
  let fetchMock: jest.Mock;

  const SCOPE = { projectId: 'p1', environment: Environment.DEVELOPMENT };
  const STREAM = {
    id: 'stream-uuid',
    publicId: 'stream_abc123',
    projectId: 'p1',
    environment: Environment.DEVELOPMENT,
    roomId: 'room-uuid',
  };

  beforeEach(() => {
    prisma = {
      liveStreamEgress: {
        upsert: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      liveStream: { findUnique: jest.fn() },
    };
    const configValues: Record<string, unknown> = {
      'egress.workerBaseUrl': 'http://egress-worker:8600',
      'egress.workerSharedSecret': 'shared-secret',
      'egress.staleSegmentThresholdMs': 20_000,
    };
    configService = { get: jest.fn((key: string) => configValues[key]) };
    rtcTokensService = {
      mintRawCredential: jest.fn().mockResolvedValue({ token: 'rtc-jwt', endpoint: 'ws://sfu', iceServers: [] }),
    };
    webhooks = { emit: jest.fn().mockResolvedValue(undefined) };
    fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 204 });
    (globalThis as { fetch: unknown }).fetch = fetchMock;

    service = new EgressControlService(prisma as never, configService as never, rtcTokensService as never, webhooks as never);
  });

  describe('egressIdentityFor() / isEgressIdentity()', () => {
    it('produces an identity that only ever contains letters, numbers, "-", "_", "."', () => {
      const identity = egressIdentityFor('stream_abc123');
      expect(identity).toMatch(/^[a-zA-Z0-9_.-]+$/);
      expect(isEgressIdentity(identity)).toBe(true);
    });

    it('does not mistake a real viewer/host identity for the egress worker', () => {
      expect(isEgressIdentity('dave')).toBe(false);
      expect(isEgressIdentity('alice')).toBe(false);
    });
  });

  describe('start()', () => {
    it('mints a subscribe-only credential and calls the worker with it', async () => {
      await service.start(SCOPE, STREAM as never);

      expect(rtcTokensService.mintRawCredential).toHaveBeenCalledWith(
        SCOPE,
        'room-uuid',
        expect.objectContaining({
          participantIdentity: egressIdentityFor('stream_abc123'),
          permissions: expect.objectContaining({ publish: false, subscribe: true }),
        }),
      );
      expect(fetchMock).toHaveBeenCalledWith(
        'http://egress-worker:8600/internal/egress/start',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ authorization: 'Bearer shared-secret' }),
        }),
      );
      expect(prisma.liveStreamEgress.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { streamId: 'stream-uuid' },
          create: expect.objectContaining({ status: LiveStreamEgressStatus.STARTING }),
        }),
      );
    });

    it('marks FAILED and emits egress_failed, without throwing, when the worker is not configured', async () => {
      configService.get = jest.fn((key: string) => (key === 'egress.workerBaseUrl' ? undefined : 'shared-secret'));

      await expect(service.start(SCOPE, STREAM as never)).resolves.toBeUndefined();

      expect(prisma.liveStreamEgress.upsert).toHaveBeenLastCalledWith(
        expect.objectContaining({ update: expect.objectContaining({ status: LiveStreamEgressStatus.FAILED }) }),
      );
      expect(webhooks.emit).toHaveBeenCalledWith(SCOPE, 'live_stream.egress_failed', expect.objectContaining({ streamId: 'stream_abc123' }));
    });

    it('marks FAILED and emits egress_failed, without throwing, when the worker call itself fails', async () => {
      fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED'));

      await expect(service.start(SCOPE, STREAM as never)).resolves.toBeUndefined();

      expect(webhooks.emit).toHaveBeenCalledWith(
        SCOPE,
        'live_stream.egress_failed',
        expect.objectContaining({ reason: expect.stringContaining('ECONNREFUSED') }),
      );
    });

    it('marks FAILED when the worker responds with a non-2xx status', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 503 });

      await service.start(SCOPE, STREAM as never);

      expect(webhooks.emit).toHaveBeenCalledWith(SCOPE, 'live_stream.egress_failed', expect.anything());
    });
  });

  describe('stop()', () => {
    it('is a no-op when egress never started', async () => {
      prisma.liveStreamEgress.findUnique.mockResolvedValue(null);

      await service.stop(SCOPE, STREAM as never);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(prisma.liveStreamEgress.update).not.toHaveBeenCalled();
    });

    it('is a no-op when already STOPPED', async () => {
      prisma.liveStreamEgress.findUnique.mockResolvedValue({ status: LiveStreamEgressStatus.STOPPED });

      await service.stop(SCOPE, STREAM as never);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('calls the worker to stop and settles the row at STOPPED', async () => {
      prisma.liveStreamEgress.findUnique.mockResolvedValue({ status: LiveStreamEgressStatus.RUNNING });

      await service.stop(SCOPE, STREAM as never);

      expect(fetchMock).toHaveBeenCalledWith(
        'http://egress-worker:8600/internal/egress/stop',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(prisma.liveStreamEgress.update).toHaveBeenLastCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: LiveStreamEgressStatus.STOPPED }) }),
      );
    });

    it('still settles at STOPPED even when the worker is unreachable — a degraded stop, not a failed one', async () => {
      prisma.liveStreamEgress.findUnique.mockResolvedValue({ status: LiveStreamEgressStatus.RUNNING });
      fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED'));

      await expect(service.stop(SCOPE, STREAM as never)).resolves.toBeUndefined();

      expect(prisma.liveStreamEgress.update).toHaveBeenLastCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: LiveStreamEgressStatus.STOPPED }) }),
      );
    });
  });

  describe('recordHeartbeat()', () => {
    it('ignores a heartbeat for a stream that no longer exists', async () => {
      prisma.liveStream.findUnique.mockResolvedValue(null);

      await service.recordHeartbeat({
        streamId: 'stream_gone',
        workerId: 'w1',
        hostConnected: true,
        ffmpegAlive: true,
        manifestReachable: true,
      });

      expect(prisma.liveStreamEgress.update).not.toHaveBeenCalled();
    });

    it('ignores a heartbeat when start() never ran for this stream', async () => {
      prisma.liveStream.findUnique.mockResolvedValue(STREAM);
      prisma.liveStreamEgress.findUnique.mockResolvedValue(null);

      await service.recordHeartbeat({
        streamId: 'stream_abc123',
        workerId: 'w1',
        hostConnected: true,
        ffmpegAlive: true,
        manifestReachable: true,
      });

      expect(prisma.liveStreamEgress.update).not.toHaveBeenCalled();
    });

    it('marks FAILED and emits egress_failed when the worker reports an error', async () => {
      prisma.liveStream.findUnique.mockResolvedValue(STREAM);
      prisma.liveStreamEgress.findUnique.mockResolvedValue({ status: LiveStreamEgressStatus.RUNNING });

      await service.recordHeartbeat({
        streamId: 'stream_abc123',
        workerId: 'w1',
        hostConnected: true,
        ffmpegAlive: false,
        manifestReachable: false,
        error: 'ffmpeg crashed',
      });

      expect(webhooks.emit).toHaveBeenCalledWith(
        SCOPE,
        'live_stream.egress_failed',
        expect.objectContaining({ reason: 'ffmpeg crashed' }),
      );
    });

    it('emits broadcast_ready exactly once, the first time the manifest becomes reachable', async () => {
      prisma.liveStream.findUnique.mockResolvedValue(STREAM);
      prisma.liveStreamEgress.findUnique
        .mockResolvedValueOnce({ status: LiveStreamEgressStatus.STARTING, playbackUrl: null, hlsReadyAt: null })
        .mockResolvedValueOnce({ status: LiveStreamEgressStatus.RUNNING, playbackUrl: 'https://cdn/x.m3u8', hlsReadyAt: new Date() });

      const heartbeat = {
        streamId: 'stream_abc123',
        workerId: 'w1',
        hostConnected: true,
        ffmpegAlive: true,
        manifestReachable: true,
        playbackUrl: 'https://cdn/x.m3u8',
      };

      await service.recordHeartbeat(heartbeat);
      await service.recordHeartbeat(heartbeat);

      expect(webhooks.emit.mock.calls.filter(([, type]) => type === 'live_stream.broadcast_ready')).toHaveLength(1);
    });

    it('does not emit broadcast_ready while the manifest is not yet reachable', async () => {
      prisma.liveStream.findUnique.mockResolvedValue(STREAM);
      prisma.liveStreamEgress.findUnique.mockResolvedValue({ status: LiveStreamEgressStatus.STARTING, playbackUrl: null });

      await service.recordHeartbeat({
        streamId: 'stream_abc123',
        workerId: 'w1',
        hostConnected: true,
        ffmpegAlive: true,
        manifestReachable: false,
      });

      expect(webhooks.emit).not.toHaveBeenCalledWith(SCOPE, 'live_stream.broadcast_ready', expect.anything());
    });
  });
});
