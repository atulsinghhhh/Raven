import { INestApplication, ValidationPipe } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { UsageKind, UsageProduct } from '../src/generated/prisma/client';
import { PrismaService } from '../src/shared/database/prisma.service';
import { Environment } from '../src/shared/environment/environment.constants';
import { AllExceptionsFilter } from '../src/shared/errors/all-exceptions.filter';
import { RedisService } from '../src/shared/redis/redis.service';
import { UsageMeterService } from '../src/modules/usage/usage-meter.service';
import { UsageCloseReason } from '../src/modules/usage/usage.constants';

/**
 * End-to-end test of Live Streaming: the real app, real Postgres/Redis
 * (`docker compose up -d` must be running), real token minting through the
 * real RTC/chat token services. Nothing here is mocked: this is what
 * caught the module-registration ordering bug unit tests could not
 * (see redis.service.ts's class doc): only booting the real AppModule
 * exercises cross-module lifecycle-hook ordering.
 */
jest.setTimeout(60_000);

describe('Live Streaming (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  let apiKey: string;
  let jwtToken: string;
  let projectId: string;
  let ownerId: string;
  let prisma: PrismaService;
  let meter: UsageMeterService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.listen(0);

    const address = app.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;

    // Same stale-rate-limit cleanup every other e2e suite in this repo does.
    const redis = app.get(RedisService);
    const stale = await redis.client.keys('ratelimit:*');
    if (stale.length > 0) await redis.client.del(...stale);

    prisma = app.get(PrismaService);
    meter = app.get(UsageMeterService);

    const registered = await request(baseUrl)
      .post('/v1/auth/register')
      .send({ email: `live-streams-e2e-${suffix}@raven.local`, password: 'correct-horse-battery-staple' })
      .expect(201);
    jwtToken = registered.body.accessToken;
    ownerId = registered.body.user.id;

    const project = await request(baseUrl)
      .post('/v1/projects')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ name: `live-streams-e2e-${suffix}` })
      .expect(201);
    projectId = project.body.id;

    const key = await request(baseUrl)
      .post(`/v1/projects/${projectId}/api-keys`)
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ name: 'e2e' })
      .expect(201);
    apiKey = key.body.key;
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a stream with a dedicated room and an attached chat conversation', async () => {
    const res = await request(baseUrl)
      .post('/v1/live-streams')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ title: 'E2E Stream', hostIdentity: 'alice' })
      .expect(201);

    expect(res.body.status).toBe('CREATED');
    expect(res.body.id).toMatch(/^stream_/);
    expect(res.body.conversationId).toMatch(/^conv_/);
    expect(res.body.chatRootMessageId).toMatch(/^msg_/);
    expect(res.body.hosts).toEqual([expect.objectContaining({ identity: 'alice', role: 'HOST' })]);
  });

  it('rejects a stream from another project with 404, not 403', async () => {
    const stream = await request(baseUrl)
      .post('/v1/live-streams')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ title: 'E2E Stream', hostIdentity: 'alice' })
      .expect(201);

    const otherProjectJwt = (
      await request(baseUrl)
        .post('/v1/auth/register')
        .send({ email: `live-streams-e2e-other-${suffix}@raven.local`, password: 'correct-horse-battery-staple' })
        .expect(201)
    ).body.accessToken;
    const otherProjectId = (
      await request(baseUrl)
        .post('/v1/projects')
        .set('Authorization', `Bearer ${otherProjectJwt}`)
        .send({ name: `other-project-${suffix}` })
        .expect(201)
    ).body.id;
    const otherApiKey = (
      await request(baseUrl)
        .post(`/v1/projects/${otherProjectId}/api-keys`)
        .set('Authorization', `Bearer ${otherProjectJwt}`)
        .send({ name: 'e2e' })
        .expect(201)
    ).body.key;

    const res = await request(baseUrl)
      .get(`/v1/live-streams/${stream.body.id}`)
      .set('Authorization', `Bearer ${otherApiKey}`)
      .expect(404);
    expect(res.body.code).toBe('RAVEN_STREAM_NOT_FOUND');
  });

  describe('lifecycle', () => {
    let streamId: string;

    beforeEach(async () => {
      const stream = await request(baseUrl)
        .post('/v1/live-streams')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ title: 'Lifecycle Stream', hostIdentity: 'alice' })
        .expect(201);
      streamId = stream.body.id;
    });

    it('rejects ending a stream that was never started', async () => {
      const res = await request(baseUrl)
        .post(`/v1/live-streams/${streamId}/end`)
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(409);
      expect(res.body.code).toBe('RAVEN_STREAM_INVALID_STATE');
    });

    it('goes CREATED → LIVE → ENDED, and rejects repeating either transition', async () => {
      const started = await request(baseUrl)
        .post(`/v1/live-streams/${streamId}/start`)
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(201);
      expect(started.body.status).toBe('LIVE');
      expect(started.body.startedAt).not.toBeNull();

      await request(baseUrl)
        .post(`/v1/live-streams/${streamId}/start`)
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(409);

      const ended = await request(baseUrl)
        .post(`/v1/live-streams/${streamId}/end`)
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(201);
      expect(ended.body.status).toBe('ENDED');
      expect(ended.body.endedAt).not.toBeNull();

      // Terminal: no ENDED → LIVE resurrection path.
      await request(baseUrl)
        .post(`/v1/live-streams/${streamId}/start`)
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(409);
      await request(baseUrl)
        .post(`/v1/live-streams/${streamId}/end`)
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(409);
    });
  });

  describe('host/viewer token boundary', () => {
    let streamId: string;

    beforeEach(async () => {
      const stream = await request(baseUrl)
        .post('/v1/live-streams')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ title: 'Token Stream', hostIdentity: 'alice' })
        .expect(201);
      streamId = stream.body.id;
    });

    it('grants a co-host full publish permissions', async () => {
      const res = await request(baseUrl)
        .post(`/v1/live-streams/${streamId}/hosts`)
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ identity: 'bob' })
        .expect(201);

      expect(res.body.role).toBe('CO_HOST');
      expect(res.body.rtc.permissions).toMatchObject({ publish: true, publishAudio: true, publishVideo: true });
      expect(res.body.chat.token).toBeDefined();
    });

    it('grants a viewer subscribe-only permissions, never publish — regardless of anything in the request body', async () => {
      const res = await request(baseUrl)
        .post(`/v1/live-streams/${streamId}/viewer-tokens`)
        // Extra fields a hostile client might try are simply rejected by
        // the whitelist ValidationPipe, not silently accepted.
        .send({ identity: 'carol' })
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(201);

      expect(res.body.role).toBe('VIEWER');
      expect(res.body.rtc.permissions).toMatchObject({
        subscribe: true,
        publish: false,
        publishAudio: false,
        publishVideo: false,
      });
    });

    it('rejects a viewer-token request carrying an unknown "role" field rather than silently ignoring it', async () => {
      const res = await request(baseUrl)
        .post(`/v1/live-streams/${streamId}/viewer-tokens`)
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ identity: 'carol', role: 'HOST' })
        .expect(400);
      expect(res.body.message).toEqual(expect.arrayContaining([expect.stringContaining('role')]));
    });

    it('lets a viewer send a chat message but not a system message, using the minted chat token', async () => {
      const viewer = await request(baseUrl)
        .post(`/v1/live-streams/${streamId}/viewer-tokens`)
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ identity: 'carol' })
        .expect(201);
      const conversationId = viewer.body.chat.conversations[0];

      await request(baseUrl)
        .post(`/v1/chat/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${viewer.body.chat.token}`)
        .send({ text: 'hello from a real viewer token' })
        .expect(201);

      const forged = await request(baseUrl)
        .post(`/v1/chat/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${viewer.body.chat.token}`)
        .send({ type: 'system', text: 'fake announcement' })
        .expect(403);
      expect(forged.body.code).toBe('RAVEN_PERMISSION_DENIED');
    });

    it("lets a viewer react to the stream's root message, aggregated on the existing reaction model", async () => {
      const stream = await request(baseUrl)
        .get(`/v1/live-streams/${streamId}`)
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(200);
      const viewer = await request(baseUrl)
        .post(`/v1/live-streams/${streamId}/viewer-tokens`)
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ identity: 'carol' })
        .expect(201);

      const res = await request(baseUrl)
        .post(`/v1/chat/messages/${stream.body.chatRootMessageId}/reactions`)
        .set('Authorization', `Bearer ${viewer.body.chat.token}`)
        .send({ emoji: '❤️' })
        .expect(201);

      expect(res.body.reactions).toEqual([{ emoji: '❤️', count: 1, userIds: ['carol'] }]);
    });
  });

  describe('webhooks', () => {
    it('accepts every new live_stream.* event type on the existing webhook registration surface', async () => {
      // Real delivery (HTTP to an endpoint, retries, signing) is
      // WebhookDeliveryWorker's own concern with its own tests, verified
      // live against a real local receiver during development (see the
      // final report) rather than re-proven here. This confirms the
      // seven new event types this feature added are validated the same
      // way every existing event type is: accepted here means a real
      // endpoint really would be able to subscribe to them.
      const events = [
        'live_stream.created',
        'live_stream.started',
        'live_stream.ended',
        'live_stream.host_joined',
        'live_stream.host_left',
        'live_stream.viewer_joined',
        'live_stream.viewer_left',
      ];

      const endpoint = await request(baseUrl)
        .post(`/v1/projects/${projectId}/webhooks`)
        .set('Authorization', `Bearer ${jwtToken}`)
        .send({ url: 'http://127.0.0.1:19999/unreachable', events })
        .expect(201);

      expect(endpoint.body.enabledEvents).toEqual(expect.arrayContaining(events));
    });
  });

  describe('free-tier concurrency (1 LIVE stream per account)', () => {
    it('lets exactly one of two simultaneous start() calls win', async () => {
      const streamA = await request(baseUrl)
        .post('/v1/live-streams')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ title: 'Race A', hostIdentity: 'alice' })
        .expect(201);
      const streamB = await request(baseUrl)
        .post('/v1/live-streams')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ title: 'Race B', hostIdentity: 'alice' })
        .expect(201);

      // The property under test: reading "am I the only LIVE stream" and
      // then writing is a race a naive count-then-act check would lose.
      // The partial unique index on live_streams(ownerId) WHERE status =
      // 'LIVE' cannot lose it — Postgres itself refuses the second write.
      const [resA, resB] = await Promise.all([
        request(baseUrl).post(`/v1/live-streams/${streamA.body.id}/start`).set('Authorization', `Bearer ${apiKey}`),
        request(baseUrl).post(`/v1/live-streams/${streamB.body.id}/start`).set('Authorization', `Bearer ${apiKey}`),
      ]);

      const statuses = [resA.status, resB.status].sort((a, b) => a - b);
      expect(statuses).toEqual([201, 403]);

      const winner = resA.status === 201 ? resA : resB;
      const loser = resA.status === 201 ? resB : resA;
      expect(winner.body.status).toBe('LIVE');
      expect(loser.body.code).toBe('RAVEN_STREAM_CONCURRENCY_LIMIT_EXCEEDED');

      // Clean up: leaves nothing LIVE for tests that run after this one.
      await request(baseUrl)
        .post(`/v1/live-streams/${winner.body.id}/end`)
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(201);
    });

    it('rejects starting a second stream while the first is still LIVE, account-wide', async () => {
      const streamA = await request(baseUrl)
        .post('/v1/live-streams')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ title: 'Sequential A', hostIdentity: 'alice' })
        .expect(201);
      const streamB = await request(baseUrl)
        .post('/v1/live-streams')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ title: 'Sequential B', hostIdentity: 'alice' })
        .expect(201);

      await request(baseUrl)
        .post(`/v1/live-streams/${streamA.body.id}/start`)
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(201);

      const rejected = await request(baseUrl)
        .post(`/v1/live-streams/${streamB.body.id}/start`)
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(403);
      expect(rejected.body.code).toBe('RAVEN_STREAM_CONCURRENCY_LIMIT_EXCEEDED');

      await request(baseUrl)
        .post(`/v1/live-streams/${streamA.body.id}/end`)
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(201);

      // The slot is free again — starting B now succeeds.
      await request(baseUrl)
        .post(`/v1/live-streams/${streamB.body.id}/start`)
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(201);
      await request(baseUrl)
        .post(`/v1/live-streams/${streamB.body.id}/end`)
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(201);
    });
  });

  describe('host-hours accounting (free tier)', () => {
    async function createAndGetRoomId(hostIdentity: string): Promise<{ streamId: string; roomId: string }> {
      const stream = await request(baseUrl)
        .post('/v1/live-streams')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ title: `Host-hours ${Date.now()}`, hostIdentity })
        .expect(201);
      const row = await prisma.liveStream.findUniqueOrThrow({
        where: { publicId: stream.body.id },
        select: { roomId: true },
      });
      return { streamId: stream.body.id, roomId: row.roomId };
    }

    it('excludes a reconnect gap, and never draws down the RTC allowance', async () => {
      const { roomId } = await createAndGetRoomId('alice');
      const rtcBefore = (await request(baseUrl).get('/v1/usage').set('Authorization', `Bearer ${jwtToken}`).expect(200))
        .body.usedMinutes;

      // 10:00 -> 10:20 (20 min), gap, 10:25 -> 10:40 (15 min) = 35 min total.
      const firstStart = new Date(Date.now() - 40 * 60 * 1000);
      const first = await meter.startSession({
        sessionKey: `ls-e2e-host-a-${Date.now()}`,
        projectId,
        environment: Environment.DEVELOPMENT,
        roomId,
        roomName: 'host-hours-room',
        participantIdentity: 'alice',
        product: UsageProduct.LIVE_STREAMING,
        kind: UsageKind.LIVE_STREAMING_HOST_MINUTES,
      });
      await prisma.usageSession.update({
        where: { id: first.id },
        data: { startedAt: firstStart, lastMeteredAt: firstStart },
      });
      await meter.settle(first.sessionKey, {
        at: new Date(firstStart.getTime() + 20 * 60 * 1000),
        close: UsageCloseReason.LEFT,
      });

      const secondStart = new Date(firstStart.getTime() + 25 * 60 * 1000);
      const second = await meter.startSession({
        sessionKey: `ls-e2e-host-b-${Date.now()}`,
        projectId,
        environment: Environment.DEVELOPMENT,
        roomId,
        roomName: 'host-hours-room',
        participantIdentity: 'alice',
        product: UsageProduct.LIVE_STREAMING,
        kind: UsageKind.LIVE_STREAMING_HOST_MINUTES,
      });
      await prisma.usageSession.update({
        where: { id: second.id },
        data: { startedAt: secondStart, lastMeteredAt: secondStart },
      });
      await meter.settle(second.sessionKey, {
        at: new Date(secondStart.getTime() + 15 * 60 * 1000),
        close: UsageCloseReason.LEFT,
      });

      const allowance = await prisma.usageAllowance.findUniqueOrThrow({
        where: { userId_product: { userId: ownerId, product: UsageProduct.LIVE_STREAMING } },
      });
      // 35 minutes, not the 40 it would be had the 5-minute gap been billed.
      expect(allowance.consumedSeconds).toBe(35 * 60);

      const rtcAfter = (await request(baseUrl).get('/v1/usage').set('Authorization', `Bearer ${jwtToken}`).expect(200))
        .body.usedMinutes;
      expect(rtcAfter).toBe(rtcBefore);
    });

    it('counts each co-host independently', async () => {
      const { roomId } = await createAndGetRoomId('carol');
      const before = await prisma.usageAllowance.findUniqueOrThrow({
        where: { userId_product: { userId: ownerId, product: UsageProduct.LIVE_STREAMING } },
      });

      const startedAt = new Date(Date.now() - 60 * 60 * 1000);
      for (const identity of ['carol', 'dave']) {
        const session = await meter.startSession({
          sessionKey: `ls-e2e-cohost-${identity}-${Date.now()}`,
          projectId,
          environment: Environment.DEVELOPMENT,
          roomId,
          roomName: 'co-host-room',
          participantIdentity: identity,
          product: UsageProduct.LIVE_STREAMING,
          kind: UsageKind.LIVE_STREAMING_HOST_MINUTES,
        });
        await prisma.usageSession.update({ where: { id: session.id }, data: { startedAt, lastMeteredAt: startedAt } });
        await meter.settle(session.sessionKey, {
          at: new Date(startedAt.getTime() + 60 * 60 * 1000),
          close: UsageCloseReason.LEFT,
        });
      }

      const after = await prisma.usageAllowance.findUniqueOrThrow({
        where: { userId_product: { userId: ownerId, product: UsageProduct.LIVE_STREAMING } },
      });
      // Two hosts, one hour each: two hours consumed, not one.
      expect(after.consumedSeconds - before.consumedSeconds).toBe(2 * 60 * 60);
    });
  });
});
