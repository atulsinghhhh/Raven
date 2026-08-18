import { INestApplication, ValidationPipe } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/shared/errors/all-exceptions.filter';
import { RedisService } from '../src/shared/redis/redis.service';

/**
 * Runs the real control plane against the real Phase 1 Postgres/Redis
 * (docker compose up -d must be running — see docs/local-development.md).
 * This is the "API -> Database -> Redis" integration layer described in
 * INFRASTRUCTURE_PHASES.md's testing strategy, not a unit test.
 */
describe('Control plane (e2e)', () => {
  let app: INestApplication;
  const uniqueSuffix = Date.now().toString(36) + Math.random().toString(36).slice(2);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    // Rate limits are IP-keyed in Redis and persist across test runs (and
    // across manual curl testing against the same local Redis) — clear
    // them so this suite starts from a known state instead of inheriting
    // whatever budget happened to be left over.
    const redis = app.get(RedisService);
    const staleKeys = await redis.client.keys('ratelimit:*');
    if (staleKeys.length > 0) {
      await redis.client.del(...staleKeys);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health reports ok with every dependency up', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.dependencies).toEqual({ database: 'up', redis: 'up', livekit: 'up', turn: 'up' });
    expect(res.body.signaling).toEqual({
      activeConnections: expect.any(Number),
      activeRooms: expect.any(Number),
      activeParticipants: expect.any(Number),
    });
  });

  describe('the full golden path', () => {
    const email = `e2e-${uniqueSuffix}@raven.local`;
    const password = 'correct-horse-battery-staple';
    let accessToken: string;
    let projectId: string;
    let apiKey: string;
    let roomId: string;

    it('registers a new developer', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/auth/register')
        .send({ email, password })
        .expect(201);

      expect(res.body.accessToken).toBeDefined();
      accessToken = res.body.accessToken;
    });

    it('rejects a duplicate registration', async () => {
      await request(app.getHttpServer())
        .post('/v1/auth/register')
        .send({ email, password })
        .expect(409);
    });

    it('logs in with the same credentials', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/auth/login')
        .send({ email, password })
        .expect(200);

      expect(res.body.accessToken).toBeDefined();
    });

    it('rejects a wrong password', async () => {
      await request(app.getHttpServer())
        .post('/v1/auth/login')
        .send({ email, password: 'wrong' })
        .expect(401);
    });

    it('creates a project for the authenticated developer', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/projects')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'E2E Project' })
        .expect(201);

      expect(res.body.ownerId).toBeDefined();
      projectId = res.body.id;
    });

    it('refuses project access without a token', async () => {
      await request(app.getHttpServer()).get('/v1/projects').expect(401);
    });

    it('creates an API key and shows the secret exactly once', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/projects/${projectId}/api-keys`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'ci-key' })
        .expect(201);

      expect(res.body.key).toMatch(/^rvk_.+\..+$/);
      apiKey = res.body.key;

      const list = await request(app.getHttpServer())
        .get(`/v1/projects/${projectId}/api-keys`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(list.body[0].key).toBeUndefined();
      expect(list.body[0].secretHash).toBeUndefined();
    });

    it('creates a room using the API key, not the developer JWT', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/rooms')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ name: 'e2e-room' })
        .expect(201);

      roomId = res.body.id;
      expect(res.body.projectId).toBe(projectId);
    });

    it('refuses room creation with a developer JWT instead of an API key', async () => {
      await request(app.getHttpServer())
        .post('/v1/rooms')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'should-fail' })
        .expect(401);
    });

    it('mints an RTC token scoped to that room with the requested grant', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/rooms/${roomId}/rtc-tokens`)
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          participantIdentity: 'alice',
          permissions: { join: true, subscribe: true, publish: true, publishAudio: true },
        })
        .expect(201);

      expect(res.body.token).toBeDefined();
      expect(res.body.roomName).toBe('e2e-room');
      expect(res.body.participantIdentity).toBe('alice');

      // iceServers: one STUN (no credentials) + TURN over UDP + TURN over
      // TCP + TURNS/TLS (Phase 5) — all TURN entries share one credential
      // pair. See turn-credential.util.ts.
      expect(res.body.iceServers).toHaveLength(4);
      const stun = res.body.iceServers.find((s: { urls: string }) => s.urls.startsWith('stun:'));
      expect(stun.username).toBeUndefined();
      const turnEntries = res.body.iceServers.filter(
        (s: { urls: string }) => s.urls.startsWith('turn:') || s.urls.startsWith('turns:'),
      );
      expect(turnEntries).toHaveLength(3);
      for (const turn of turnEntries) {
        expect(turn.username).toContain('alice');
        expect(turn.credential).toBeDefined();
      }
      expect(res.body.iceServers.some((s: { urls: string }) => s.urls.startsWith('turns:'))).toBe(true);
    });

    it('mints a token that actually expires at the requested ttlSeconds', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/rooms/${roomId}/rtc-tokens`)
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ participantIdentity: 'expiry-check', ttlSeconds: 30 })
        .expect(201);

      const requestedAt = Date.now();
      const expiresAt = new Date(res.body.expiresAt).getTime();
      // Allow generous scheduling slack — the point is "~30s, not
      // unbounded/permanent", not exact-to-the-millisecond timing.
      expect(expiresAt - requestedAt).toBeGreaterThan(20_000);
      expect(expiresAt - requestedAt).toBeLessThan(40_000);

      // The claim actually inside the signed JWT must match, too — not
      // just the control-plane's own bookkeeping of what it asked for.
      const [, payloadB64] = res.body.token.split('.');
      const claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
      expect(claims.exp - claims.nbf).toBeCloseTo(30, -1);
    });

    it('rejects an out-of-range ttlSeconds (no permanent tokens allowed)', async () => {
      await request(app.getHttpServer())
        .post(`/v1/rooms/${roomId}/rtc-tokens`)
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ participantIdentity: 'greedy', ttlSeconds: 999_999 })
        .expect(400);
    });

    it('rejects minting a token for a room in a different project', async () => {
      // A second project's API key must not be able to mint tokens for
      // the first project's room — this is the same cross-project
      // boundary enforced everywhere else in the control plane.
      const otherProjectRes = await request(app.getHttpServer())
        .post('/v1/projects')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Other Project' })
        .expect(201);

      const otherKeyRes = await request(app.getHttpServer())
        .post(`/v1/projects/${otherProjectRes.body.id}/api-keys`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({})
        .expect(201);

      await request(app.getHttpServer())
        .post(`/v1/rooms/${roomId}/rtc-tokens`)
        .set('Authorization', `Bearer ${otherKeyRes.body.key}`)
        .send({ participantIdentity: 'mallory' })
        .expect(404);
    });

    describe('observability — telemetry ingest and developer-facing queries (Phase 9)', () => {
      let rtcToken: string;
      let connectionPublicId: string;

      it('mints a fresh RTC token to use as the telemetry bearer', async () => {
        const res = await request(app.getHttpServer())
          .post(`/v1/rooms/${roomId}/rtc-tokens`)
          .set('Authorization', `Bearer ${apiKey}`)
          .send({ participantIdentity: 'observability-participant' })
          .expect(201);

        rtcToken = res.body.token;
        expect(res.body.telemetryUrl).toBeDefined();
      });

      it('rejects telemetry ingestion without a valid RTC token', async () => {
        await request(app.getHttpServer())
          .post('/v1/telemetry/events')
          .send({ connectionId: 'conn_unauthenticated', type: 'connection_started' })
          .expect(401);
      });

      it('records a real connection lifecycle from ingested events, visible to the project owner', async () => {
        connectionPublicId = `conn_e2e${Date.now().toString(36)}`;

        await request(app.getHttpServer())
          .post('/v1/telemetry/events')
          .set('Authorization', `Bearer ${rtcToken}`)
          .send({
            connectionId: connectionPublicId,
            type: 'connection_started',
            data: { sdkVersion: '0.1.0', platform: 'web', browser: 'chrome' },
          })
          .expect(204);

        await request(app.getHttpServer())
          .post('/v1/telemetry/events')
          .set('Authorization', `Bearer ${rtcToken}`)
          .send({ connectionId: connectionPublicId, type: 'connected' })
          .expect(204);

        const list = await request(app.getHttpServer())
          .get(`/v1/projects/${projectId}/connections`)
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200);
        const found = list.body.find((c: { publicId: string }) => c.publicId === connectionPublicId);
        expect(found).toBeDefined();
        expect(found.state).toBe('CONNECTED');
        expect(found.roomId).toBe(roomId);
        expect(found.sdkVersion).toBe('0.1.0');

        const detail = await request(app.getHttpServer())
          .get(`/v1/projects/${projectId}/connections/${connectionPublicId}`)
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200);
        expect(detail.body.events).toHaveLength(2);
        expect(detail.body.events[0].type).toBe('connection_started');
      });

      it('classifies an ingested error into a Raven-facing category — never the raw SDK code as-is', async () => {
        await request(app.getHttpServer())
          .post('/v1/telemetry/events')
          .set('Authorization', `Bearer ${rtcToken}`)
          .send({
            connectionId: connectionPublicId,
            type: 'error',
            data: { code: 'TOKEN_EXPIRED', message: 'RTC token has expired' },
          })
          .expect(204);

        const errors = await request(app.getHttpServer())
          .get(`/v1/projects/${projectId}/errors`)
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200);
        const found = errors.body.find((e: { message: string }) => e.message === 'RTC token has expired');
        expect(found).toBeDefined();
        expect(found.category).toBe('TOKEN_ERROR');
        expect(found.likelyCause).toBeTruthy();
        expect(found.suggestedAction).toBeTruthy();
        // Every ID a developer sees must be the public conn_... one, never
        // the internal database uuid FK.
        expect(found.connectionId).toBe(connectionPublicId);

        const detail = await request(app.getHttpServer())
          .get(`/v1/projects/${projectId}/errors/${found.publicId}`)
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200);
        expect(detail.body.connection.publicId).toBe(connectionPublicId);
      });

      it('reports real, non-fabricated metrics for the project', async () => {
        const metrics = await request(app.getHttpServer())
          .get(`/v1/projects/${projectId}/metrics?range=1h`)
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200);

        expect(metrics.body.connections).toBeGreaterThanOrEqual(1);
        expect(typeof metrics.body.errors).toBe('number');
      });

      it('reports real per-dependency diagnostics for the project', async () => {
        const diagnostics = await request(app.getHttpServer())
          .get(`/v1/projects/${projectId}/diagnostics`)
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200);

        expect(diagnostics.body.api).toBe('up');
        expect(diagnostics.body.dependencies.sfu).toBe('up');
        expect(diagnostics.body.dependencies.turn).toBe('up');
        expect(diagnostics.body.project.id).toBe(projectId);
      });
    });

    describe('server SDK API-key-guarded endpoints (Phase 10)', () => {
      it('GET /v1/project returns the API key\'s own project, with no project ID needed', async () => {
        const res = await request(app.getHttpServer())
          .get('/v1/project')
          .set('Authorization', `Bearer ${apiKey}`)
          .expect(200);

        expect(res.body.id).toBe(projectId);
        expect(res.body.name).toBe('E2E Project');
      });

      it('GET /v1/rooms/:id/participants lists live participants via the API key (no JWT needed)', async () => {
        const res = await request(app.getHttpServer())
          .get(`/v1/rooms/${roomId}/participants`)
          .set('Authorization', `Bearer ${apiKey}`)
          .expect(200);

        // null (SFU unreachable) or an array — never a fabricated non-empty list.
        expect(res.body === null || Array.isArray(res.body)).toBe(true);
      });

      it('GET /v1/connections and /v1/errors work with the API key and see the same data the dashboard sees', async () => {
        const connections = await request(app.getHttpServer())
          .get('/v1/connections')
          .set('Authorization', `Bearer ${apiKey}`)
          .expect(200);
        expect(connections.body.some((c: { roomId: string }) => c.roomId === roomId)).toBe(true);

        const errors = await request(app.getHttpServer())
          .get('/v1/errors')
          .set('Authorization', `Bearer ${apiKey}`)
          .expect(200);
        expect(errors.body.some((e: { message: string }) => e.message === 'RTC token has expired')).toBe(true);
      });

      it('GET /v1/metrics and /v1/diagnostics work with the API key', async () => {
        const metrics = await request(app.getHttpServer())
          .get('/v1/metrics?range=1h')
          .set('Authorization', `Bearer ${apiKey}`)
          .expect(200);
        expect(metrics.body.connections).toBeGreaterThanOrEqual(1);

        const diagnostics = await request(app.getHttpServer())
          .get('/v1/diagnostics')
          .set('Authorization', `Bearer ${apiKey}`)
          .expect(200);
        expect(diagnostics.body.project.id).toBe(projectId);
      });

      it('rejects every server-SDK endpoint with a developer JWT instead of an API key', async () => {
        await request(app.getHttpServer()).get('/v1/project').set('Authorization', `Bearer ${accessToken}`).expect(401);
        await request(app.getHttpServer()).get('/v1/connections').set('Authorization', `Bearer ${accessToken}`).expect(401);
        await request(app.getHttpServer()).get('/v1/diagnostics').set('Authorization', `Bearer ${accessToken}`).expect(401);
      });
    });

    it('closes the room', async () => {
      await request(app.getHttpServer())
        .delete(`/v1/rooms/${roomId}`)
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(204);

      // A closed room is no longer returned by the project's active list.
      const list = await request(app.getHttpServer())
        .get('/v1/rooms')
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(200);
      expect(list.body.find((r: { id: string }) => r.id === roomId)).toBeUndefined();
    });

    it('deletes (archives) the developer\'s own project', async () => {
      await request(app.getHttpServer())
        .delete(`/v1/projects/${projectId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(204);

      const list = await request(app.getHttpServer())
        .get('/v1/projects')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(list.body.find((p: { id: string }) => p.id === projectId)).toBeUndefined();
    });

    it('logs out and invalidates the developer JWT immediately', async () => {
      await request(app.getHttpServer())
        .post('/v1/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(204);

      await request(app.getHttpServer())
        .get('/v1/projects')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(401);
    });
  });

  describe('resource-level authorization boundaries', () => {
    // User
    //   ↓ owns Project
    //     ↓ owns Room
    //       ↓ can create/manage RTC tokens
    // Every hop in that chain must reject a caller who isn't the owner —
    // this block tests each hop explicitly, beyond what the golden path
    // already covers incidentally.
    let ownerToken: string;
    let ownerProjectId: string;
    let ownerApiKey: string;
    let ownerRoomId: string;
    let ownerKeyId: string;
    let intruderToken: string;

    beforeAll(async () => {
      const owner = await request(app.getHttpServer())
        .post('/v1/auth/register')
        .send({ email: `owner-${uniqueSuffix}@raven.local`, password: 'correct-horse-battery' })
        .expect(201);
      ownerToken = owner.body.accessToken;

      const intruder = await request(app.getHttpServer())
        .post('/v1/auth/register')
        .send({ email: `intruder-${uniqueSuffix}@raven.local`, password: 'correct-horse-battery' })
        .expect(201);
      intruderToken = intruder.body.accessToken;

      const project = await request(app.getHttpServer())
        .post('/v1/projects')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Owner Project' })
        .expect(201);
      ownerProjectId = project.body.id;

      const key = await request(app.getHttpServer())
        .post(`/v1/projects/${ownerProjectId}/api-keys`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'owner-key' })
        .expect(201);
      ownerApiKey = key.body.key;
      ownerKeyId = key.body.id;

      const room = await request(app.getHttpServer())
        .post('/v1/rooms')
        .set('Authorization', `Bearer ${ownerApiKey}`)
        .send({ name: 'owner-room' })
        .expect(201);
      ownerRoomId = room.body.id;
    });

    it('an intruder cannot read the owner\'s project', async () => {
      await request(app.getHttpServer())
        .get(`/v1/projects/${ownerProjectId}`)
        .set('Authorization', `Bearer ${intruderToken}`)
        .expect(404);
    });

    it('an intruder cannot modify the owner\'s project', async () => {
      await request(app.getHttpServer())
        .patch(`/v1/projects/${ownerProjectId}`)
        .set('Authorization', `Bearer ${intruderToken}`)
        .send({ name: 'Pwned' })
        .expect(404);
    });

    it('an intruder cannot delete the owner\'s project', async () => {
      await request(app.getHttpServer())
        .delete(`/v1/projects/${ownerProjectId}`)
        .set('Authorization', `Bearer ${intruderToken}`)
        .expect(404);
    });

    it('an intruder cannot list or create API keys under the owner\'s project', async () => {
      await request(app.getHttpServer())
        .get(`/v1/projects/${ownerProjectId}/api-keys`)
        .set('Authorization', `Bearer ${intruderToken}`)
        .expect(404);

      await request(app.getHttpServer())
        .post(`/v1/projects/${ownerProjectId}/api-keys`)
        .set('Authorization', `Bearer ${intruderToken}`)
        .send({})
        .expect(404);
    });

    it('an intruder cannot revoke the owner\'s API key', async () => {
      await request(app.getHttpServer())
        .delete(`/v1/projects/${ownerProjectId}/api-keys/${ownerKeyId}`)
        .set('Authorization', `Bearer ${intruderToken}`)
        .expect(404);

      // Prove it's still usable — the revoke attempt must not have
      // succeeded silently.
      await request(app.getHttpServer())
        .post('/v1/rooms')
        .set('Authorization', `Bearer ${ownerApiKey}`)
        .send({ name: 'still-works' })
        .expect(201);
    });

    it('an intruder\'s own API key cannot read or manage the owner\'s rooms', async () => {
      const intruderProject = await request(app.getHttpServer())
        .post('/v1/projects')
        .set('Authorization', `Bearer ${intruderToken}`)
        .send({ name: 'Intruder Project' })
        .expect(201);

      const intruderKey = await request(app.getHttpServer())
        .post(`/v1/projects/${intruderProject.body.id}/api-keys`)
        .set('Authorization', `Bearer ${intruderToken}`)
        .send({})
        .expect(201);

      await request(app.getHttpServer())
        .get(`/v1/rooms/${ownerRoomId}`)
        .set('Authorization', `Bearer ${intruderKey.body.key}`)
        .expect(404);

      await request(app.getHttpServer())
        .delete(`/v1/rooms/${ownerRoomId}`)
        .set('Authorization', `Bearer ${intruderKey.body.key}`)
        .expect(404);

      await request(app.getHttpServer())
        .post(`/v1/rooms/${ownerRoomId}/rtc-tokens`)
        .set('Authorization', `Bearer ${intruderKey.body.key}`)
        .send({ participantIdentity: 'intruder' })
        .expect(404);
    });

    it('an intruder cannot list, view, or mint a test token for the owner\'s rooms via the dashboard endpoints', async () => {
      await request(app.getHttpServer())
        .get(`/v1/projects/${ownerProjectId}/rooms`)
        .set('Authorization', `Bearer ${intruderToken}`)
        .expect(404);

      await request(app.getHttpServer())
        .get(`/v1/projects/${ownerProjectId}/rooms/${ownerRoomId}`)
        .set('Authorization', `Bearer ${intruderToken}`)
        .expect(404);

      await request(app.getHttpServer())
        .post(`/v1/projects/${ownerProjectId}/rooms/${ownerRoomId}/test-token`)
        .set('Authorization', `Bearer ${intruderToken}`)
        .send({})
        .expect(404);
    });

    it('the owner can list/view their own rooms via the dashboard endpoints and mint a test token', async () => {
      const list = await request(app.getHttpServer())
        .get(`/v1/projects/${ownerProjectId}/rooms`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(list.body).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: ownerRoomId, liveParticipantCount: expect.anything() })]),
      );

      const detail = await request(app.getHttpServer())
        .get(`/v1/projects/${ownerProjectId}/rooms/${ownerRoomId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(detail.body).toMatchObject({ id: ownerRoomId });
      expect(detail.body).toHaveProperty('liveParticipants');

      const testToken = await request(app.getHttpServer())
        .post(`/v1/projects/${ownerProjectId}/rooms/${ownerRoomId}/test-token`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({})
        .expect(201);
      expect(testToken.body).toHaveProperty('token');
      expect(testToken.body.participantIdentity).toBe('dashboard-test-user');
    });

    it('the owner can create a room via the JWT-guarded dashboard/CLI endpoint (Phase 8)', async () => {
      const created = await request(app.getHttpServer())
        .post(`/v1/projects/${ownerProjectId}/rooms`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'cli-created-room' })
        .expect(201);
      expect(created.body).toMatchObject({ name: 'cli-created-room', projectId: ownerProjectId });

      // It's a real, listable room — not a fire-and-forget no-op.
      const list = await request(app.getHttpServer())
        .get(`/v1/projects/${ownerProjectId}/rooms`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(list.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.body.id })]));
    });

    it('an intruder cannot create a room in the owner\'s project via the JWT-guarded endpoint', async () => {
      await request(app.getHttpServer())
        .post(`/v1/projects/${ownerProjectId}/rooms`)
        .set('Authorization', `Bearer ${intruderToken}`)
        .send({ name: 'intruder-room' })
        .expect(404);
    });

    it('an intruder cannot read the owner\'s connections, errors, metrics, or diagnostics', async () => {
      await request(app.getHttpServer())
        .get(`/v1/projects/${ownerProjectId}/connections`)
        .set('Authorization', `Bearer ${intruderToken}`)
        .expect(404);

      await request(app.getHttpServer())
        .get(`/v1/projects/${ownerProjectId}/errors`)
        .set('Authorization', `Bearer ${intruderToken}`)
        .expect(404);

      await request(app.getHttpServer())
        .get(`/v1/projects/${ownerProjectId}/metrics`)
        .set('Authorization', `Bearer ${intruderToken}`)
        .expect(404);

      await request(app.getHttpServer())
        .get(`/v1/projects/${ownerProjectId}/diagnostics`)
        .set('Authorization', `Bearer ${intruderToken}`)
        .expect(404);
    });
  });

  describe('rate limiting', () => {
    it('eventually rejects repeated login attempts from the same client with 429', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 15; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const res = await request(app.getHttpServer())
          .post('/v1/auth/login')
          .send({ email: 'nonexistent@raven.local', password: 'wrong' });
        statuses.push(res.status);
      }

      expect(statuses).toContain(429);
    });
  });
});
