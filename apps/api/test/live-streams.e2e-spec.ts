import { INestApplication, ValidationPipe } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/shared/errors/all-exceptions.filter';
import { RedisService } from '../src/shared/redis/redis.service';

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

    const registered = await request(baseUrl)
      .post('/v1/auth/register')
      .send({ email: `live-streams-e2e-${suffix}@raven.local`, password: 'correct-horse-battery-staple' })
      .expect(201);
    jwtToken = registered.body.accessToken;

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

    it('lets a viewer react to the stream\'s root message, aggregated on the existing reaction model', async () => {
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
});
