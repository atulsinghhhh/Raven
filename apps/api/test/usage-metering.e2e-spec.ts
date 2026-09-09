import { INestApplication, ValidationPipe } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/shared/database/prisma.service';
import { Environment } from '../src/shared/environment/environment.constants';
import { AllExceptionsFilter } from '../src/shared/errors/all-exceptions.filter';
import { RedisService } from '../src/shared/redis/redis.service';
import { UsageAllowanceService } from '../src/modules/usage/usage-allowance.service';
import { UsageMeterService } from '../src/modules/usage/usage-meter.service';
import { UsageCloseReason, minutesToSeconds } from '../src/modules/usage/usage.constants';

/**
 * Free-tier metering end to end, against real Postgres and Redis.
 *
 * The unit specs cover the arithmetic and the interleaving cases with an
 * in-memory store. What they *cannot* cover is the property the design
 * actually rests on: that `consumedSeconds = consumedSeconds + delta` under
 * a Postgres row lock does not lose updates when writers are genuinely
 * parallel, and that the unique index on `sessionKey` is what makes
 * `startSession` idempotent. Both of those are database behaviour, so they
 * are tested against a database.
 *
 * Deliberately SFU-free: nothing here opens a media session, so this suite
 * runs with just the data stores up.
 */
jest.setTimeout(60_000);

const FREE_TIER_MINUTES = 20_000;

describe('Usage metering (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let prisma: PrismaService;
  let meter: UsageMeterService;
  let allowances: UsageAllowanceService;

  const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const email = `usage-e2e-${suffix}@raven.local`;
  const password = 'correct-horse-battery-staple';

  let jwtToken: string;
  let apiKey: string;
  let userId: string;
  let projectId: string;
  let roomId: string;

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

    prisma = app.get(PrismaService);
    meter = app.get(UsageMeterService);
    allowances = app.get(UsageAllowanceService);

    // Same stale-rate-limit cleanup every other e2e suite in this repo does.
    const redis = app.get(RedisService);
    const stale = await redis.client.keys('ratelimit:*');
    if (stale.length > 0) await redis.client.del(...stale);

    const registered = await request(baseUrl).post('/v1/auth/register').send({ email, password }).expect(201);
    jwtToken = registered.body.accessToken;
    userId = registered.body.user.id;

    const project = await request(baseUrl)
      .post('/v1/projects')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ name: `usage-e2e-${suffix}` })
      .expect(201);
    projectId = project.body.id;

    const key = await request(baseUrl)
      .post(`/v1/projects/${projectId}/api-keys`)
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ name: 'e2e' })
      .expect(201);
    apiKey = key.body.key;

    const room = await request(baseUrl)
      .post('/v1/rooms')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ name: `usage-e2e-${suffix}` })
      .expect(201);
    roomId = room.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  /** Puts the allowance back to a known state between the destructive tests below. */
  async function resetAllowance(consumedSeconds = 0): Promise<void> {
    await prisma.usageSession.deleteMany({ where: { userId } });
    await prisma.usageAllowance.update({
      where: { userId },
      data: { consumedSeconds, exhaustedAt: null },
    });
  }

  async function openSession(sessionKey: string, startedAt?: Date) {
    const session = await meter.startSession({
      sessionKey,
      projectId,
      environment: Environment.DEVELOPMENT,
      roomId,
      roomName: `usage-e2e-${suffix}`,
      participantIdentity: 'alice',
    });
    if (startedAt) {
      // Backdated so a test can settle a plausible amount of time without
      // waiting for it. The service never lets a client influence this;
      // only a test reaches past it.
      return prisma.usageSession.update({
        where: { id: session.id },
        data: { startedAt, lastMeteredAt: startedAt },
      });
    }
    return session;
  }

  describe('allocation', () => {
    it('grants every newly registered developer the free-tier minutes', async () => {
      const res = await request(baseUrl).get('/v1/usage').set('Authorization', `Bearer ${jwtToken}`).expect(200);

      expect(res.body).toMatchObject({
        includedMinutes: FREE_TIER_MINUTES,
        usedMinutes: 0,
        remainingMinutes: FREE_TIER_MINUTES,
        usedPercent: 0,
        exhausted: false,
        source: 'FREE_TIER',
      });
    });

    it('stores the allowance as a row, not a number the API derives on the fly', async () => {
      const row = await prisma.usageAllowance.findUnique({ where: { userId } });

      expect(row).toMatchObject({ includedMinutes: FREE_TIER_MINUTES, consumedSeconds: 0, exhaustedAt: null });
    });

    it('grants exactly one allowance however many times provisioning runs', async () => {
      await Promise.all([
        allowances.ensureProvisioned(userId),
        allowances.ensureProvisioned(userId),
        allowances.ensureProvisioned(userId),
      ]);

      expect(await prisma.usageAllowance.count({ where: { userId } })).toBe(1);
    });

    it('requires a session to read usage at all', async () => {
      await request(baseUrl).get('/v1/usage').expect(401);
    });
  });

  describe('consumption', () => {
    beforeEach(async () => {
      await resetAllowance();
    });

    it('records a session against the developer allowance', async () => {
      const startedAt = new Date(Date.now() - 10 * 60 * 1000);
      const session = await openSession(`e2e-consume-${Date.now()}`, startedAt);

      await meter.settle(session.sessionKey, { close: UsageCloseReason.LEFT });

      const res = await request(baseUrl).get('/v1/usage').set('Authorization', `Bearer ${jwtToken}`).expect(200);
      expect(res.body.usedMinutes).toBe(10);
      expect(res.body.remainingMinutes).toBe(FREE_TIER_MINUTES - 10);
    });

    it('surfaces the session in the usage history with its project attribution', async () => {
      const startedAt = new Date(Date.now() - 5 * 60 * 1000);
      const session = await openSession(`e2e-history-${Date.now()}`, startedAt);
      await meter.settle(session.sessionKey, { close: UsageCloseReason.LEFT });

      const res = await request(baseUrl).get('/v1/usage/detail').set('Authorization', `Bearer ${jwtToken}`).expect(200);

      expect(res.body.history[0]).toMatchObject({
        projectId,
        meteredMinutes: 5,
        closeReason: UsageCloseReason.LEFT,
        live: false,
      });
      expect(res.body.byProject[0]).toMatchObject({ projectId, minutes: 5 });
      expect(res.body.daily[res.body.daily.length - 1].minutes).toBe(5);
    });

    it('opens one meter per session key, even when two joins race', async () => {
      const sessionKey = `e2e-race-${Date.now()}`;

      const results = await Promise.all([openSession(sessionKey), openSession(sessionKey), openSession(sessionKey)]);

      const ids = new Set(results.map((session) => session.id));
      expect(ids.size).toBe(1);
      expect(await prisma.usageSession.count({ where: { sessionKey } })).toBe(1);
    });
  });

  describe('concurrency', () => {
    beforeEach(async () => {
      await resetAllowance();
    });

    it('sums twenty parallel sessions without losing a single update', async () => {
      // The property under test is the SQL increment under a row lock. A
      // read-modify-write in Node would silently drop most of these.
      const startedAt = new Date(Date.now() - 60 * 1000);
      const sessions = await Promise.all(
        Array.from({ length: 20 }, (_, i) => openSession(`e2e-parallel-${Date.now()}-${i}`, startedAt)),
      );

      await Promise.all(sessions.map((session) => meter.settle(session.sessionKey, { close: UsageCloseReason.LEFT })));

      const allowance = await prisma.usageAllowance.findUniqueOrThrow({ where: { userId } });
      // 20 participants x 60 seconds. Nothing more, nothing less.
      expect(allowance.consumedSeconds).toBe(20 * 60);
    });

    it('credits one session once when eight settlements of it run in parallel', async () => {
      const startedAt = new Date(Date.now() - 120 * 1000);
      const session = await openSession(`e2e-dup-${Date.now()}`, startedAt);

      const at = new Date(startedAt.getTime() + 120 * 1000);
      await Promise.all(Array.from({ length: 8 }, () => meter.settle(session.sessionKey, { at })));

      const allowance = await prisma.usageAllowance.findUniqueOrThrow({ where: { userId } });
      expect(allowance.consumedSeconds).toBe(120);

      const row = await prisma.usageSession.findUniqueOrThrow({ where: { id: session.id } });
      expect(row.meteredSeconds).toBe(120);
    });

    it('credits nothing for a settlement that arrives after the session closed', async () => {
      // A closed session is final, enforced by the `endedAt: null` in the
      // compare-and-swap rather than by call-path convention.
      const startedAt = new Date(Date.now() - 60 * 60 * 1000);
      const session = await openSession(`e2e-after-close-${Date.now()}`, startedAt);
      await meter.settle(session.sessionKey, {
        at: new Date(startedAt.getTime() + 60_000),
        close: UsageCloseReason.LEFT,
      });

      const before = await prisma.usageAllowance.findUniqueOrThrow({ where: { userId } });
      expect(await meter.settle(session.sessionKey)).toBeNull();
      const after = await prisma.usageAllowance.findUniqueOrThrow({ where: { userId } });

      expect(after.consumedSeconds).toBe(before.consumedSeconds);
      expect(before.consumedSeconds).toBe(60);
    });

    it('keeps the allowance counter equal to the sum of its sessions', async () => {
      // The denormalised counter is only worth having if it cannot drift.
      const startedAt = new Date(Date.now() - 90 * 1000);
      const sessions = await Promise.all(
        Array.from({ length: 6 }, (_, i) => openSession(`e2e-sum-${Date.now()}-${i}`, startedAt)),
      );
      const at = new Date(startedAt.getTime() + 90 * 1000);

      // Settle each one repeatedly and out of order, the way a sweep, a
      // leave and a reaper pass would overlap in production.
      await Promise.all(
        sessions.flatMap((session) => [
          meter.settle(session.sessionKey, { at }),
          meter.settle(session.sessionKey, { at }),
          meter.settle(session.sessionKey, { at, close: UsageCloseReason.LEFT }),
        ]),
      );

      const [allowance, aggregate] = await Promise.all([
        prisma.usageAllowance.findUniqueOrThrow({ where: { userId } }),
        prisma.usageSession.aggregate({ where: { userId }, _sum: { meteredSeconds: true } }),
      ]);

      expect(allowance.consumedSeconds).toBe(aggregate._sum.meteredSeconds);
      expect(allowance.consumedSeconds).toBe(6 * 90);
    });
  });

  describe('exhaustion', () => {
    afterEach(async () => {
      await resetAllowance();
    });

    it('reports the allowance as spent, with a percentage that stops at 100', async () => {
      await resetAllowance(minutesToSeconds(FREE_TIER_MINUTES));

      const res = await request(baseUrl).get('/v1/usage').set('Authorization', `Bearer ${jwtToken}`).expect(200);

      expect(res.body).toMatchObject({
        exhausted: true,
        usedMinutes: FREE_TIER_MINUTES,
        remainingMinutes: 0,
        usedPercent: 100,
      });
    });

    it('refuses to mint a new RTC token, with a code a caller can switch on', async () => {
      await resetAllowance(minutesToSeconds(FREE_TIER_MINUTES));

      const res = await request(baseUrl)
        .post(`/v1/rooms/${roomId}/rtc-tokens`)
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ participantIdentity: 'alice' })
        .expect(403);

      expect(res.body).toMatchObject({
        code: 'RAVEN_USAGE_LIMIT_EXCEEDED',
        includedMinutes: FREE_TIER_MINUTES,
        remainingMinutes: 0,
      });
    });

    it('mints tokens again the moment there are minutes to spend', async () => {
      await resetAllowance(minutesToSeconds(FREE_TIER_MINUTES - 1));

      await request(baseUrl)
        .post(`/v1/rooms/${roomId}/rtc-tokens`)
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ participantIdentity: 'alice' })
        .expect(201);
    });

    it('stamps exhaustedAt once and never resets the allowance', async () => {
      await resetAllowance(minutesToSeconds(FREE_TIER_MINUTES) - 30);
      const startedAt = new Date(Date.now() - 60 * 1000);
      const session = await openSession(`e2e-exhaust-${Date.now()}`, startedAt);

      const crossing = await meter.settle(session.sessionKey, { close: UsageCloseReason.LEFT });
      expect(crossing?.justExhausted).toBe(true);

      const first = await prisma.usageAllowance.findUniqueOrThrow({ where: { userId } });
      expect(first.exhaustedAt).not.toBeNull();

      // Another session, and a re-read of the summary. Neither may clear
      // the stamp or hand the minutes back.
      const another = await openSession(`e2e-exhaust-again-${Date.now()}`, startedAt);
      await meter.settle(another.sessionKey, { close: UsageCloseReason.LEFT });
      await request(baseUrl).get('/v1/usage').set('Authorization', `Bearer ${jwtToken}`).expect(200);

      const second = await prisma.usageAllowance.findUniqueOrThrow({ where: { userId } });
      expect(second.exhaustedAt).toEqual(first.exhaustedAt);
      expect(second.includedMinutes).toBe(FREE_TIER_MINUTES);
      expect(second.consumedSeconds).toBeGreaterThan(first.consumedSeconds);
    });

    it('exposes no endpoint that could grant, adjust or reset an allowance', async () => {
      // Those are Admin Portal operations, and the Admin Portal does not
      // exist yet. This test is here to fail loudly if one appears by
      // accident.
      for (const path of ['/v1/usage', '/v1/usage/detail', `/v1/projects/${projectId}/usage`]) {
        await request(baseUrl)
          .post(path)
          .set('Authorization', `Bearer ${jwtToken}`)
          .send({ includedMinutes: 1 })
          .expect(404);
        await request(baseUrl)
          .patch(path)
          .set('Authorization', `Bearer ${jwtToken}`)
          .send({ includedMinutes: 1 })
          .expect(404);
        await request(baseUrl).delete(path).set('Authorization', `Bearer ${jwtToken}`).expect(404);
      }
    });
  });

  describe('abandoned sessions', () => {
    beforeEach(async () => {
      await resetAllowance();
    });

    it('closes a session whose gateway died, crediting it only to its last confirmed-alive instant', async () => {
      const startedAt = new Date(Date.now() - 60 * 60 * 1000);
      const lastAlive = new Date(startedAt.getTime() + 10 * 60 * 1000);
      const session = await openSession(`e2e-abandoned-${Date.now()}`, startedAt);
      await prisma.usageSession.update({
        where: { id: session.id },
        data: { lastMeteredAt: lastAlive, meteredSeconds: 0 },
      });

      await meter.reap();

      const row = await prisma.usageSession.findUniqueOrThrow({ where: { id: session.id } });
      expect(row.closeReason).toBe(UsageCloseReason.ABANDONED);
      expect(row.endedAt).toEqual(lastAlive);
      // Ten minutes, not the fifty it would have been had the reaper
      // credited it up to now.
      expect(row.meteredSeconds).toBe(10 * 60);

      const allowance = await prisma.usageAllowance.findUniqueOrThrow({ where: { userId } });
      expect(allowance.consumedSeconds).toBe(10 * 60);
    });

    it('is safe to reap twice, as two instances would', async () => {
      const startedAt = new Date(Date.now() - 60 * 60 * 1000);
      const session = await openSession(`e2e-reap-twice-${Date.now()}`, startedAt);
      await prisma.usageSession.update({
        where: { id: session.id },
        data: { lastMeteredAt: new Date(startedAt.getTime() + 5 * 60 * 1000) },
      });

      await Promise.all([meter.reap(), meter.reap()]);

      const allowance = await prisma.usageAllowance.findUniqueOrThrow({ where: { userId } });
      expect(allowance.consumedSeconds).toBe(5 * 60);
    });
  });

  describe('project-scoped usage', () => {
    it('reports the owner allowance the project actually draws down', async () => {
      await resetAllowance();
      const startedAt = new Date(Date.now() - 3 * 60 * 1000);
      const session = await openSession(`e2e-project-${Date.now()}`, startedAt);
      await meter.settle(session.sessionKey, { close: UsageCloseReason.LEFT });

      const res = await request(baseUrl)
        .get(`/v1/projects/${projectId}/usage`)
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);

      expect(res.body.ownedByCaller).toBe(true);
      expect(res.body.summary).toMatchObject({ includedMinutes: FREE_TIER_MINUTES, usedMinutes: 3 });
      expect(res.body.history[0]).toMatchObject({ projectId, meteredMinutes: 3 });
    });

    it('is gated on usage:read, so the BILLING role can read it', async () => {
      // BILLING's whole grant is project:read + usage:read + billing:manage
      // (project-permissions.ts). This route is the first one usage:read
      // has ever gated, so it is the first that role can actually reach.
      const billingEmail = `usage-e2e-billing-${suffix}@raven.local`;
      const invitee = await request(baseUrl)
        .post('/v1/auth/register')
        .send({ email: billingEmail, password })
        .expect(201);

      await request(baseUrl)
        .post(`/v1/projects/${projectId}/members`)
        .set('Authorization', `Bearer ${jwtToken}`)
        .send({ email: billingEmail, role: 'BILLING' })
        .expect(201);

      const res = await request(baseUrl)
        .get(`/v1/projects/${projectId}/usage`)
        .set('Authorization', `Bearer ${invitee.body.accessToken}`)
        .expect(200);

      // They read the owner's meter, not their own untouched allowance.
      expect(res.body.ownedByCaller).toBe(false);
      expect(res.body.summary.includedMinutes).toBe(FREE_TIER_MINUTES);
    });

    it('hides a project the caller is not a member of', async () => {
      const other = await request(baseUrl)
        .post('/v1/auth/register')
        .send({ email: `usage-e2e-other-${suffix}@raven.local`, password })
        .expect(201);

      await request(baseUrl)
        .get(`/v1/projects/${projectId}/usage`)
        .set('Authorization', `Bearer ${other.body.accessToken}`)
        .expect(404);
    });
  });
});
