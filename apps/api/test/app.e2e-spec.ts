import { INestApplication, ValidationPipe } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/shared/errors/all-exceptions.filter';
import { RedisService } from '../src/shared/redis/redis.service';
import { registerLocalSfu } from './helpers/register-local-sfu';

/**
 * Runs the real control plane against the real Postgres/Redis/SFU/coturn
 * (`docker compose up -d` must be running: see
 * docs/local-development.md). This is the "API -> Database -> Redis"
 * integration layer described in INFRASTRUCTURE_PHASES.md's testing
 * strategy, not a unit test.
 *
 * The RTC plane needs one extra step now that the SFU fleet registers
 * itself: the compose node registers with the compose API's database, not
 * with the scratch one this suite uses, so `beforeAll` registers it here
 * through the real endpoint. See `helpers/register-local-sfu.ts`.
 */
describe('Control plane (e2e)', () => {
  let app: INestApplication;
  const uniqueSuffix = Date.now().toString(36) + Math.random().toString(36).slice(2);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    // Rate limits are IP-keyed in Redis and persist across test runs (and
    // across manual curl testing against the same local Redis): clear
    // them so this suite starts from a known state instead of inheriting
    // whatever budget happened to be left over.
    const redis = app.get(RedisService);
    const staleKeys = await redis.client.keys('ratelimit:*');
    if (staleKeys.length > 0) {
      await redis.client.del(...staleKeys);
    }

    // Must come after `app.init()` and before any test that reads /health
    // or diagnostics: both report the RTC plane by probing a registered
    // node, and there is no row for one until this runs.
    await registerLocalSfu(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health reports ok with every dependency up', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.dependencies).toEqual({ database: 'up', redis: 'up', sfu: 'up', turn: 'up' });
    expect(res.body.signaling).toEqual({
      activeConnections: expect.any(Number),
      activeRooms: expect.any(Number),
      activeParticipants: expect.any(Number),
    });
  });

  it('GET /health/live reports ok without checking any dependency', async () => {
    const res = await request(app.getHttpServer()).get('/health/live').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('GET /health/ready matches GET /health', async () => {
    const [ready, alias] = await Promise.all([
      request(app.getHttpServer()).get('/health/ready').expect(200),
      request(app.getHttpServer()).get('/health').expect(200),
    ]);
    expect(ready.body).toEqual(alias.body);
  });

  it('GET /metrics exposes Prometheus text with route-templated labels, not raw request paths', async () => {
    // Hit a parameterized route first so its /metrics label is proven to
    // be the route pattern, not this specific 404 id.
    await request(app.getHttpServer())
      .get('/v1/rooms/route-label-check')
      .expect((res) => {
        expect([401, 404]).toContain(res.status);
      });

    // Same fallback configuration.ts gives metrics.scrapeSecret, so this
    // is the value MetricsAuthGuard actually expects in this environment.
    const scrapeSecret = process.env.METRICS_SCRAPE_SECRET ?? process.env.JWT_SECRET;

    await request(app.getHttpServer()).get('/metrics').expect(401);

    const res = await request(app.getHttpServer())
      .get('/metrics')
      .set('Authorization', `Bearer ${scrapeSecret}`)
      .expect(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('raven_http_requests_total');
    expect(res.text).toContain('raven_chat_connections_active');
    expect(res.text).toContain('raven_signaling_rooms_active');
    expect(res.text).toContain('raven_webhook_deliveries_pending');
    expect(res.text).not.toContain('route-label-check');
  });

  describe('the full golden path', () => {
    const email = `e2e-${uniqueSuffix}@raven.local`;
    const password = 'correct-horse-battery-staple';
    let accessToken: string;
    let projectId: string;
    let apiKey: string;
    let roomId: string;

    it('registers a new developer', async () => {
      const res = await request(app.getHttpServer()).post('/v1/auth/register').send({ email, password }).expect(201);

      expect(res.body.accessToken).toBeDefined();
      accessToken = res.body.accessToken;
    });

    it('rejects a duplicate registration', async () => {
      await request(app.getHttpServer()).post('/v1/auth/register').send({ email, password }).expect(409);
    });

    it('logs in with the same credentials', async () => {
      const res = await request(app.getHttpServer()).post('/v1/auth/login').send({ email, password }).expect(200);

      expect(res.body.accessToken).toBeDefined();
    });

    it('rejects a wrong password', async () => {
      await request(app.getHttpServer()).post('/v1/auth/login').send({ email, password: 'wrong' }).expect(401);
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

    it('replays the original room instead of creating a duplicate when the same Idempotency-Key is retried', async () => {
      const idempotencyKey = `idem-${uniqueSuffix}`;

      const first = await request(app.getHttpServer())
        .post('/v1/rooms')
        .set('Authorization', `Bearer ${apiKey}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({ name: `e2e-idempotent-room-${uniqueSuffix}` })
        .expect(201);

      const second = await request(app.getHttpServer())
        .post('/v1/rooms')
        .set('Authorization', `Bearer ${apiKey}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({ name: `e2e-idempotent-room-${uniqueSuffix}` })
        .expect(201);

      expect(second.body).toEqual(first.body);

      const list = await request(app.getHttpServer())
        .get('/v1/rooms')
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(200);
      expect(list.body.filter((r: { id: string }) => r.id === first.body.id)).toHaveLength(1);
    });

    it('rejects a reused Idempotency-Key sent with a different room name', async () => {
      const idempotencyKey = `idem-conflict-${uniqueSuffix}`;

      await request(app.getHttpServer())
        .post('/v1/rooms')
        .set('Authorization', `Bearer ${apiKey}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({ name: `e2e-idempotent-conflict-a-${uniqueSuffix}` })
        .expect(201);

      const conflict = await request(app.getHttpServer())
        .post('/v1/rooms')
        .set('Authorization', `Bearer ${apiKey}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({ name: `e2e-idempotent-conflict-b-${uniqueSuffix}` })
        .expect(409);
      expect(conflict.body.code).toBe('RAVEN_CONFLICT');
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
      // TCP + TURNS/TLS (Phase 5): all TURN entries share one credential
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
      // Allow generous scheduling slack: the point is "~30s, not
      // unbounded/permanent", not exact-to-the-millisecond timing.
      expect(expiresAt - requestedAt).toBeGreaterThan(20_000);
      expect(expiresAt - requestedAt).toBeLessThan(40_000);

      // The claims actually inside the signed JWT must match, too: not
      // just the control-plane's own bookkeeping of what it asked for.
      // `iat`/`exp`, not `nbf`: Livqeno's token format is its own, and the
      // signer never issues a not-before.
      const [, payloadB64] = res.body.token.split('.');
      const claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
      expect(claims.exp - claims.iat).toBeCloseTo(30, -1);
      // Audience-scoped, so a chat token or a dashboard session JWT can
      // never be replayed as an RTC token.
      expect(claims.aud).toBe('raven-rtc');
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
      // the first project's room: this is the same cross-project
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

      it('records connection-quality stats from a stats event, in the shape Room.getConnectionStats() actually sends', async () => {
        // Mirrors what @ravenkash/rtc's periodic stats monitor posts: see
        // ConnectionStats in packages/sdk/src/room.ts.
        await request(app.getHttpServer())
          .post('/v1/telemetry/events')
          .set('Authorization', `Bearer ${rtcToken}`)
          .send({
            connectionId: connectionPublicId,
            type: 'stats',
            data: {
              connectionState: 'connected',
              connectionQuality: 'good',
              local: [{ kind: 'microphone', direction: 'send', roundTripTimeMs: 84, jitterMs: 5, bitrateBps: 32_000 }],
              remote: [
                {
                  kind: 'camera',
                  direction: 'receive',
                  jitterMs: 18,
                  packetLossPercent: 2.5,
                  bitrateBps: 850_000,
                  codec: 'video/VP8',
                },
              ],
            },
          })
          .expect(204);

        const detail = await request(app.getHttpServer())
          .get(`/v1/projects/${projectId}/connections/${connectionPublicId}`)
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200);

        expect(detail.body).toMatchObject({
          connectionQuality: 'good',
          rttMs: 84, // from the local (send-direction) track — the only direction WebRTC reports it for
          jitterMs: 18, // the worse of the two reported values, not the first or an average
          packetLossPercent: 2.5,
          bitrateBps: 882_000, // summed across both tracks
          codec: 'video/VP8', // from the remote track — mimeType is receive-direction-only
        });
      });

      it('classifies an ingested error into a Livqeno-facing category — never the raw SDK code as-is', async () => {
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
      it("GET /v1/project returns the API key's own project, with no project ID needed", async () => {
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

        // null (SFU unreachable) or an array: never a fabricated non-empty list.
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
        await request(app.getHttpServer())
          .get('/v1/connections')
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(401);
        await request(app.getHttpServer())
          .get('/v1/diagnostics')
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(401);
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

    it("deletes (archives) the developer's own project", async () => {
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

      await request(app.getHttpServer()).get('/v1/projects').set('Authorization', `Bearer ${accessToken}`).expect(401);
    });
  });

  describe('resource-level authorization boundaries', () => {
    // User
    //   ↓ owns Project
    //     ↓ owns Room
    //       ↓ can create/manage RTC tokens
    // Every hop in that chain must reject a caller who isn't the owner;
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

    it("an intruder cannot read the owner's project", async () => {
      await request(app.getHttpServer())
        .get(`/v1/projects/${ownerProjectId}`)
        .set('Authorization', `Bearer ${intruderToken}`)
        .expect(404);
    });

    it("an intruder cannot modify the owner's project", async () => {
      await request(app.getHttpServer())
        .patch(`/v1/projects/${ownerProjectId}`)
        .set('Authorization', `Bearer ${intruderToken}`)
        .send({ name: 'Pwned' })
        .expect(404);
    });

    it("an intruder cannot delete the owner's project", async () => {
      await request(app.getHttpServer())
        .delete(`/v1/projects/${ownerProjectId}`)
        .set('Authorization', `Bearer ${intruderToken}`)
        .expect(404);
    });

    it("an intruder cannot list or create API keys under the owner's project", async () => {
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

    it("an intruder cannot revoke the owner's API key", async () => {
      await request(app.getHttpServer())
        .delete(`/v1/projects/${ownerProjectId}/api-keys/${ownerKeyId}`)
        .set('Authorization', `Bearer ${intruderToken}`)
        .expect(404);

      // Prove it's still usable: the revoke attempt must not have
      // succeeded silently.
      await request(app.getHttpServer())
        .post('/v1/rooms')
        .set('Authorization', `Bearer ${ownerApiKey}`)
        .send({ name: 'still-works' })
        .expect(201);
    });

    it("an intruder's own API key cannot read or manage the owner's rooms", async () => {
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

    it("an intruder cannot list, view, or mint a test token for the owner's rooms via the dashboard endpoints", async () => {
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

      // It's a real, listable room: not a fire-and-forget no-op.
      const list = await request(app.getHttpServer())
        .get(`/v1/projects/${ownerProjectId}/rooms`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(list.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.body.id })]));
    });

    it("an intruder cannot create a room in the owner's project via the JWT-guarded endpoint", async () => {
      await request(app.getHttpServer())
        .post(`/v1/projects/${ownerProjectId}/rooms`)
        .set('Authorization', `Bearer ${intruderToken}`)
        .send({ name: 'intruder-room' })
        .expect(404);
    });

    it("an intruder cannot read the owner's connections, errors, metrics, or diagnostics", async () => {
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

  describe('environment isolation', () => {
    // The guarantee under test: two keys in the same project, different
    // environments, cannot see each other's data at all.
    const email = `env-${uniqueSuffix}@raven.local`;
    const password = 'correct-horse-battery-staple';
    let devKey: string;
    let prodKey: string;
    let prodRoomId: string;

    beforeAll(async () => {
      const registered = await request(app.getHttpServer())
        .post('/v1/auth/register')
        .send({ email, password, name: 'Env Tester' })
        .expect(201);
      const token = registered.body.accessToken;

      const project = await request(app.getHttpServer())
        .post('/v1/projects')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: `env-project-${uniqueSuffix}` })
        .expect(201);

      const dev = await request(app.getHttpServer())
        .post(`/v1/projects/${project.body.id}/api-keys`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'dev-key', environment: 'DEVELOPMENT' })
        .expect(201);
      devKey = dev.body.key;

      const prod = await request(app.getHttpServer())
        .post(`/v1/projects/${project.body.id}/api-keys`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'prod-key', environment: 'PRODUCTION' })
        .expect(201);
      prodKey = prod.body.key;
    });

    it('marks the environment in the key itself, so a production key is recognisable', () => {
      expect(devKey).toMatch(/^rvk_dev_/);
      expect(prodKey).toMatch(/^rvk_prod_/);
    });

    it('lets the same room name exist in two environments', async () => {
      await request(app.getHttpServer())
        .post('/v1/rooms')
        .set('Authorization', `Bearer ${devKey}`)
        .send({ name: 'lobby' })
        .expect(201);

      // Without environment in the uniqueness constraint this would 409.
      const prodRoom = await request(app.getHttpServer())
        .post('/v1/rooms')
        .set('Authorization', `Bearer ${prodKey}`)
        .send({ name: 'lobby' })
        .expect(201);

      prodRoomId = prodRoom.body.id;
    });

    it('hides a production room from a development key holding its id', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/rooms/${prodRoomId}`)
        .set('Authorization', `Bearer ${devKey}`)
        .expect(404);

      // Not-found rather than forbidden: a 403 would confirm the id is real.
      expect(res.body.code).toBe('RAVEN_ROOM_NOT_FOUND');
    });

    it('refuses to mint an RTC token for another environment’s room', async () => {
      await request(app.getHttpServer())
        .post(`/v1/rooms/${prodRoomId}/rtc-tokens`)
        .set('Authorization', `Bearer ${devKey}`)
        .send({ participantIdentity: 'mallory' })
        .expect(404);
    });

    it('lists only the calling environment’s rooms', async () => {
      const dev = await request(app.getHttpServer())
        .get('/v1/rooms')
        .set('Authorization', `Bearer ${devKey}`)
        .expect(200);

      expect(dev.body.every((room: { id: string }) => room.id !== prodRoomId)).toBe(true);
    });

    it('refuses to close a room in another environment', async () => {
      await request(app.getHttpServer())
        .delete(`/v1/rooms/${prodRoomId}`)
        .set('Authorization', `Bearer ${devKey}`)
        .expect(404);

      // Still reachable by the key that owns it: the room was not closed.
      await request(app.getHttpServer())
        .get(`/v1/rooms/${prodRoomId}`)
        .set('Authorization', `Bearer ${prodKey}`)
        .expect(200);
    });
  });

  describe('project roles', () => {
    // Two real accounts and one project, exercising the boundary that the
    // capability table is supposed to enforce.
    // Distinct prefixes: the cross-tenant suite above already claims
    // `owner-${uniqueSuffix}`, and both run against the same database.
    const ownerEmail = `roleowner-${uniqueSuffix}@raven.local`;
    const viewerEmail = `roleviewer-${uniqueSuffix}@raven.local`;
    const password = 'correct-horse-battery-staple';
    let ownerToken: string;
    let viewerToken: string;
    let viewerUserId: string;
    let ownerUserId: string;
    let projectId: string;

    beforeAll(async () => {
      const redis = app.get(RedisService);
      const keys = await redis.client.keys('ratelimit:*');
      if (keys.length > 0) {
        await redis.client.del(...keys);
      }

      const owner = await request(app.getHttpServer())
        .post('/v1/auth/register')
        .send({ email: ownerEmail, password, name: 'Owner' })
        .expect(201);
      ownerToken = owner.body.accessToken;

      const viewer = await request(app.getHttpServer())
        .post('/v1/auth/register')
        .send({ email: viewerEmail, password, name: 'Viewer' })
        .expect(201);
      viewerToken = viewer.body.accessToken;
      viewerUserId = viewer.body.user.id;

      const project = await request(app.getHttpServer())
        .post('/v1/projects')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: `roles-project-${uniqueSuffix}` })
        .expect(201);
      projectId = project.body.id;
      ownerUserId = owner.body.user.id;
    });

    it('makes the creator an owner automatically', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/projects/${projectId}/members`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({ email: ownerEmail, role: 'OWNER' });
    });

    it('hides the project entirely from a non-member', async () => {
      // 404, not 403: a 403 would confirm the id is real.
      const res = await request(app.getHttpServer())
        .get(`/v1/projects/${projectId}`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(404);

      expect(res.body.code).toBe('RAVEN_PROJECT_NOT_FOUND');
    });

    it('adds a member with an explicit role', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/projects/${projectId}/members`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ email: viewerEmail, role: 'VIEWER' })
        .expect(201);

      expect(res.body).toMatchObject({ role: 'VIEWER' });
      // The capability list travels with the member so a dashboard need
      // not keep its own copy of the matrix.
      expect(res.body.capabilities).toContain('project:read');
      expect(res.body.capabilities).not.toContain('keys:manage');
    });

    it('lets that viewer read the project now', async () => {
      await request(app.getHttpServer())
        .get(`/v1/projects/${projectId}`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);
    });

    it('refuses the viewer an API key with 403, not 404', async () => {
      // They can see the project, so hiding it would only send them
      // hunting for a bug instead of asking for access.
      const res = await request(app.getHttpServer())
        .post(`/v1/projects/${projectId}/api-keys`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ name: 'sneaky' })
        .expect(403);

      expect(res.body.code).toBe('RAVEN_PERMISSION_DENIED');
      expect(res.body.message).toMatch(/viewer/i);
    });

    it('refuses the viewer a webhook, a room, and the members list changes', async () => {
      await request(app.getHttpServer())
        .post(`/v1/projects/${projectId}/webhooks`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ url: 'https://example.com/hook' })
        .expect(403);

      await request(app.getHttpServer())
        .post(`/v1/projects/${projectId}/rooms`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ name: 'viewer-room' })
        .expect(403);

      await request(app.getHttpServer())
        .post(`/v1/projects/${projectId}/members`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ email: ownerEmail, role: 'VIEWER' })
        .expect(403);
    });

    it('still lets the viewer read what a viewer should read', async () => {
      await request(app.getHttpServer())
        .get(`/v1/projects/${projectId}/api-keys`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .get(`/v1/projects/${projectId}/members`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);
    });

    it('promotes the viewer to developer and the refusals turn into successes', async () => {
      await request(app.getHttpServer())
        .patch(`/v1/projects/${projectId}/members/${viewerUserId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ role: 'DEVELOPER' })
        .expect(200);

      await request(app.getHttpServer())
        .post(`/v1/projects/${projectId}/api-keys`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ name: 'now-allowed' })
        .expect(201);
    });

    it('still refuses a developer the owner-only actions', async () => {
      await request(app.getHttpServer())
        .delete(`/v1/projects/${projectId}`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(403);

      await request(app.getHttpServer())
        .patch(`/v1/projects/${projectId}/members/${viewerUserId}`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ role: 'OWNER' })
        .expect(403);
    });

    it('refuses to leave the project with no owner', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/v1/projects/${projectId}/members/${ownerUserId}`)
        .set('Authorization', `Bearer ${ownerToken}`);

      // A project with no owner cannot be administered by anyone: not
      // even to appoint a replacement, so the last one is not removable.
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('RAVEN_VALIDATION_FAILED');
    });
  });

  describe('audit log', () => {
    const email = `audit-${uniqueSuffix}@raven.local`;
    const password = 'correct-horse-battery-staple';
    let token: string;
    let projectId: string;
    let keyPublicId: string;
    let keyId: string;
    let rawKey: string;

    beforeAll(async () => {
      const redis = app.get(RedisService);
      const keys = await redis.client.keys('ratelimit:*');
      if (keys.length > 0) {
        await redis.client.del(...keys);
      }

      const registered = await request(app.getHttpServer())
        .post('/v1/auth/register')
        .send({ email, password, name: 'Auditor' })
        .expect(201);
      token = registered.body.accessToken;

      const project = await request(app.getHttpServer())
        .post('/v1/projects')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: `audit-project-${uniqueSuffix}` })
        .expect(201);
      projectId = project.body.id;

      const key = await request(app.getHttpServer())
        .post(`/v1/projects/${projectId}/api-keys`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'audited-key', environment: 'PRODUCTION' })
        .expect(201);
      keyPublicId = key.body.publicId;
      keyId = key.body.id;
      rawKey = key.body.key;
    });

    it('records project creation and key creation, newest first', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/projects/${projectId}/audit-logs`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.map((e: { action: string }) => e.action)).toEqual(['api_key.created', 'project.created']);
    });

    it('names the actor, the resource, and the request that caused it', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/projects/${projectId}/audit-logs?action=api_key.created`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body[0]).toMatchObject({
        action: 'api_key.created',
        actorEmail: email,
        resourceType: 'api_key',
        resourceId: keyPublicId,
        environment: 'PRODUCTION',
      });
      expect(res.body[0].requestId).toMatch(/^req_/);
      expect(res.body[0].publicId).toMatch(/^aud_/);
    });

    it('never records the secret half of a credential', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/projects/${projectId}/audit-logs`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // The secret is not in the audit trail for the same reason it is not
      // in the database: it was shown once and never stored. The public
      // half is expected here: it is what makes the entry useful.
      const serialised = JSON.stringify(res.body);
      const secretHalf = rawKey.split('.')[1];

      expect(serialised).not.toContain(rawKey);
      expect(serialised).not.toContain(secretHalf);
      expect(serialised).toContain(keyPublicId);
    });

    it('records a revocation against the same resource id', async () => {
      await request(app.getHttpServer())
        .delete(`/v1/projects/${projectId}/api-keys/${keyId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      const res = await request(app.getHttpServer())
        .get(`/v1/projects/${projectId}/audit-logs?resourceId=${keyPublicId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Both halves of the key's life, queryable by the id a developer has.
      expect(res.body.map((e: { action: string }) => e.action)).toEqual(['api_key.revoked', 'api_key.created']);
    });

    it('offers no way to change or delete an entry', async () => {
      const entry = await request(app.getHttpServer())
        .get(`/v1/projects/${projectId}/audit-logs`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // An audit log an administrator can edit is not an audit log.
      await request(app.getHttpServer())
        .delete(`/v1/projects/${projectId}/audit-logs/${entry.body[0].publicId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);

      await request(app.getHttpServer())
        .patch(`/v1/projects/${projectId}/audit-logs/${entry.body[0].publicId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ action: 'nothing.happened' })
        .expect(404);
    });

    it('rejects an unknown action filter rather than silently returning everything', async () => {
      await request(app.getHttpServer())
        .get(`/v1/projects/${projectId}/audit-logs?action=made.up`)
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('is hidden from a member without audit:read', async () => {
      const viewerEmail = `auditviewer-${uniqueSuffix}@raven.local`;
      const viewer = await request(app.getHttpServer())
        .post('/v1/auth/register')
        .send({ email: viewerEmail, password, name: 'Viewer' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/v1/projects/${projectId}/members`)
        .set('Authorization', `Bearer ${token}`)
        .send({ email: viewerEmail, role: 'DEVELOPER' })
        .expect(201);

      // A developer can create keys but cannot read who else has been
      // creating them.
      const res = await request(app.getHttpServer())
        .get(`/v1/projects/${projectId}/audit-logs`)
        .set('Authorization', `Bearer ${viewer.body.accessToken}`)
        .expect(403);

      expect(res.body.code).toBe('RAVEN_PERMISSION_DENIED');
    });

    it('records the membership change that just happened', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/projects/${projectId}/audit-logs?action=member.added`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body[0]).toMatchObject({ action: 'member.added', actorEmail: email });
      expect(res.body[0].metadata).toMatchObject({ role: 'DEVELOPER' });
    });
  });

  describe('the error envelope', () => {
    // The limiter is keyed on IP alone, so every suite above shares one
    // budget with this one and the register route can already be spent by
    // the time these run. Clearing it here keeps the assertions about
    // *error shape* from failing over an unrelated 429.
    beforeAll(async () => {
      const redis = app.get(RedisService);
      const keys = await redis.client.keys('ratelimit:*');
      if (keys.length > 0) {
        await redis.client.del(...keys);
      }
    });

    // Every error body shape a developer will actually meet, checked
    // against the running app instead of a constructed exception.

    it('carries a canonical code, a request id, and the path', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/projects/does-not-exist')
        .set('Authorization', 'Bearer not-a-real-token')
        .expect(401);

      expect(res.body).toMatchObject({
        code: 'RAVEN_AUTH_ERROR',
        requestId: expect.stringMatching(/^req_[0-9a-f]{24}$/),
        path: '/v1/projects/does-not-exist',
      });
      expect(typeof res.body.message).toBe('string');
    });

    it('returns the same id in the body and the x-request-id header', async () => {
      // Support asks for "the request id"; two different values would make
      // that question ambiguous.
      const res = await request(app.getHttpServer()).get('/v1/projects').expect(401);

      expect(res.body.requestId).toBe(res.headers['x-request-id']);
    });

    it('adopts a well-formed inbound request id so both sides can correlate', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/projects')
        .set('x-request-id', 'req_from_the_caller')
        .expect(401);

      expect(res.body.requestId).toBe('req_from_the_caller');
    });

    it('discards a hostile inbound request id rather than echoing it', async () => {
      // A newline here would forge a second line in our logs.
      const res = await request(app.getHttpServer())
        .get('/v1/projects')
        .set('x-request-id', 'req_ok evil=true')
        .expect(401);

      expect(res.body.requestId).not.toContain('evil');
      expect(res.body.requestId).toMatch(/^req_[0-9a-f]{24}$/);
    });

    it('still ships the pre-prefix code for callers mid-migration', async () => {
      const res = await request(app.getHttpServer()).get('/v1/projects').expect(401);

      expect(res.body.legacyCode).toBe('UNAUTHORIZED');
    });

    it('codes a framework-generated 404 the same way a handler would', async () => {
      // Nest's own not-found response carries no code of its own. Without
      // the filter deriving one, callers would see a coded body from our
      // services and an uncoded body from the framework.
      const res = await request(app.getHttpServer()).get('/v1/no-such-route').expect(404);

      expect(res.body.code).toBe('RAVEN_NOT_FOUND');
      expect(res.body.requestId).toMatch(/^req_/);
    });

    it('codes a validation failure from the global pipe', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/auth/register')
        .send({ email: 'not-an-email' })
        .expect(400);

      expect(res.body.code).toBe('RAVEN_VALIDATION_FAILED');
    });
  });

  describe('rate limiting', () => {
    it('eventually rejects repeated login attempts from the same client with 429', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 15; i += 1) {
        // Sequential on purpose: the limiter counts requests in order,
        // and firing these in parallel would race its counter.
        const res = await request(app.getHttpServer())
          .post('/v1/auth/login')
          .send({ email: 'nonexistent@raven.local', password: 'wrong' });
        statuses.push(res.status);
      }

      expect(statuses).toContain(429);
    });

    it('reports retryAfterSeconds on the 429 so a client knows when to try again', async () => {
      const statuses: Array<{ status: number; body: Record<string, unknown> }> = [];
      for (let i = 0; i < 15; i += 1) {
        const res = await request(app.getHttpServer())
          .post('/v1/auth/login')
          .send({ email: 'still-nonexistent@raven.local', password: 'wrong' });
        statuses.push({ status: res.status, body: res.body });
      }

      const limited = statuses.find((s) => s.status === 429);
      expect(limited?.body).toMatchObject({
        code: 'RAVEN_RATE_LIMITED',
        retryAfterSeconds: expect.any(Number),
      });
    });

    it('gives two authenticated users independent budgets on the same rate-limited route', async () => {
      // Every request in this test comes from the same test process, so
      // it is effectively the NAT scenario: one IP, two identities. Before
      // this rework the guard keyed on IP alone, so userB below would have
      // inherited whatever budget userA had already spent.
      const password = 'correct-horse-battery-staple';

      const userA = await request(app.getHttpServer())
        .post('/v1/auth/register')
        .send({ email: `ratelimit-a-${uniqueSuffix}@raven.local`, password, name: 'A' })
        .expect(201);
      const projectA = await request(app.getHttpServer())
        .post('/v1/projects')
        .set('Authorization', `Bearer ${userA.body.accessToken}`)
        .send({ name: `ratelimit-project-a-${uniqueSuffix}` })
        .expect(201);

      const userB = await request(app.getHttpServer())
        .post('/v1/auth/register')
        .send({ email: `ratelimit-b-${uniqueSuffix}@raven.local`, password, name: 'B' })
        .expect(201);
      const projectB = await request(app.getHttpServer())
        .post('/v1/projects')
        .set('Authorization', `Bearer ${userB.body.accessToken}`)
        .send({ name: `ratelimit-project-b-${uniqueSuffix}` })
        .expect(201);

      // api-keys create is capped at 20/window (see api-keys.controller.ts).
      // Spend user A's budget past the cap.
      const statusesA: number[] = [];
      for (let i = 0; i < 22; i += 1) {
        const res = await request(app.getHttpServer())
          .post(`/v1/projects/${projectA.body.id}/api-keys`)
          .set('Authorization', `Bearer ${userA.body.accessToken}`)
          .send({ name: `key-${i}` });
        statusesA.push(res.status);
      }
      expect(statusesA).toContain(429);

      // User B, same window, same effective IP, untouched budget.
      await request(app.getHttpServer())
        .post(`/v1/projects/${projectB.body.id}/api-keys`)
        .set('Authorization', `Bearer ${userB.body.accessToken}`)
        .send({ name: 'first-key' })
        .expect(201);
    });

    it('gives two API keys on the same project independent budgets', async () => {
      // 62 sequential round-trips comfortably exceeds Jest's 5s default.
      // Isolation one level finer than the test above: even the same
      // project's two keys must not share a limiter, so a noisy or
      // compromised key cannot spend its sibling's headroom.
      const password = 'correct-horse-battery-staple';

      const user = await request(app.getHttpServer())
        .post('/v1/auth/register')
        .send({ email: `ratelimit-c-${uniqueSuffix}@raven.local`, password, name: 'C' })
        .expect(201);
      const project = await request(app.getHttpServer())
        .post('/v1/projects')
        .set('Authorization', `Bearer ${user.body.accessToken}`)
        .send({ name: `ratelimit-project-c-${uniqueSuffix}` })
        .expect(201);

      const keyOne = await request(app.getHttpServer())
        .post(`/v1/projects/${project.body.id}/api-keys`)
        .set('Authorization', `Bearer ${user.body.accessToken}`)
        .send({ name: 'key-one' })
        .expect(201);
      const keyTwo = await request(app.getHttpServer())
        .post(`/v1/projects/${project.body.id}/api-keys`)
        .set('Authorization', `Bearer ${user.body.accessToken}`)
        .send({ name: 'key-two' })
        .expect(201);

      // rtc-tokens create is capped at 60/window and is API-key-authed.
      // Room creation itself is not rate-limited, so this needs only one.
      const room = await request(app.getHttpServer())
        .post('/v1/rooms')
        .set('Authorization', `Bearer ${keyOne.body.key}`)
        .send({ name: `ratelimit-room-${uniqueSuffix}` })
        .expect(201);

      const statusesKeyOne: number[] = [];
      for (let i = 0; i < 62; i += 1) {
        const res = await request(app.getHttpServer())
          .post(`/v1/rooms/${room.body.id}/rtc-tokens`)
          .set('Authorization', `Bearer ${keyOne.body.key}`)
          .send({ participantIdentity: `p-${i}` });
        statusesKeyOne.push(res.status);
      }
      expect(statusesKeyOne).toContain(429);

      // keyTwo belongs to the same project, but has spent nothing.
      await request(app.getHttpServer())
        .post(`/v1/rooms/${room.body.id}/rtc-tokens`)
        .set('Authorization', `Bearer ${keyTwo.body.key}`)
        .send({ participantIdentity: 'still-fine' })
        .expect(201);
    }, 20_000);
  });
});
