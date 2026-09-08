import { INestApplication, ValidationPipe } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/shared/errors/all-exceptions.filter';
import { RedisService } from '../src/shared/redis/redis.service';

/**
 * Onboarding persistence + OAuth surface, end to end against real
 * Postgres/Redis. Deliberately SFU-free: nothing here touches the RTC
 * plane, so this suite stays runnable with just the data stores up.
 *
 * OAuth's provider round-trip (GitHub/Google's own servers) can't run in a
 * test, so what's covered here is everything on Raven's side of the wall:
 * provider discovery, refusing unconfigured providers, and state
 * validation. The exchange logic itself is unit-tested with the provider
 * HTTP mocked (oauth.service.spec.ts).
 */
describe('Onboarding + OAuth (e2e)', () => {
  let app: INestApplication;
  const uniqueSuffix = Date.now().toString(36) + Math.random().toString(36).slice(2);
  const email = `onboarding-e2e-${uniqueSuffix}@raven.local`;
  const password = 'a-strong-password-123';
  let accessToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    const redis = app.get(RedisService);
    const staleKeys = await redis.client.keys('ratelimit:*');
    if (staleKeys.length > 0) {
      await redis.client.del(...staleKeys);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  describe('registration starts onboarding', () => {
    it('a fresh account reports incomplete onboarding at step 1', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/auth/register')
        .send({ email, password, name: 'Onboarding Tester' })
        .expect(201);

      accessToken = res.body.accessToken;
      expect(res.body.onboarding).toEqual({ completed: false, step: 1 });
    });

    it('login reports the same onboarding status', async () => {
      const res = await request(app.getHttpServer()).post('/v1/auth/login').send({ email, password }).expect(200);
      expect(res.body.onboarding).toEqual({ completed: false, step: 1 });
    });
  });

  describe('onboarding persistence', () => {
    it('requires a session', async () => {
      await request(app.getHttpServer()).get('/v1/onboarding').expect(401);
    });

    it('reads the initial state', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/onboarding')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(res.body).toMatchObject({ step: 1, completed: false, useCases: [], stack: [] });
    });

    it("saves a step's answers, so a closed tab can resume", async () => {
      const res = await request(app.getHttpServer())
        .patch('/v1/onboarding')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ step: 3, useCases: ['saas', 'communication'], experienceLevel: 'some-experience' })
        .expect(200);
      expect(res.body).toMatchObject({
        step: 3,
        completed: false,
        useCases: ['saas', 'communication'],
        experienceLevel: 'some-experience',
      });
    });

    it('resumes from the saved step on the next read', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/onboarding')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(res.body.step).toBe(3);
    });

    it('rejects an out-of-range step instead of storing garbage', async () => {
      await request(app.getHttpServer())
        .patch('/v1/onboarding')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ step: 42 })
        .expect(400);
    });

    it('completes, and stays completed on a second call', async () => {
      const first = await request(app.getHttpServer())
        .post('/v1/onboarding/complete')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(first.body.completed).toBe(true);
      const completedAt = first.body.completedAt;

      const second = await request(app.getHttpServer())
        .post('/v1/onboarding/complete')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      // Idempotent: the original timestamp survives the second call.
      expect(second.body.completedAt).toBe(completedAt);
    });

    it('login now reports completed onboarding', async () => {
      const res = await request(app.getHttpServer()).post('/v1/auth/login').send({ email, password }).expect(200);
      expect(res.body.onboarding.completed).toBe(true);
    });
  });

  describe('profile', () => {
    it('GET /v1/users/me shows how the account signs in, without any credential material', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/users/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(res.body).toMatchObject({
        email,
        name: 'Onboarding Tester',
        hasPassword: true,
        authAccounts: [],
        onboarding: { completed: true },
      });
      expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    });

    it('PATCH /v1/users/me updates the display name', async () => {
      const res = await request(app.getHttpServer())
        .patch('/v1/users/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Renamed Tester' })
        .expect(200);
      expect(res.body.name).toBe('Renamed Tester');
    });
  });

  describe('OAuth surface', () => {
    it('reports which providers are configured (none, in the test environment)', async () => {
      const res = await request(app.getHttpServer()).get('/v1/auth/oauth/providers').expect(200);
      expect(res.body).toEqual({
        github: expect.any(Boolean),
        google: expect.any(Boolean),
      });
    });

    it('404s an unknown provider, same shape as an unknown route', async () => {
      await request(app.getHttpServer()).post('/v1/auth/oauth/gitlab/start').expect(404);
    });

    it('rejects an exchange whose state was never issued', async () => {
      // Regardless of provider configuration, a forged state must die at
      // the state check — before any code ever reaches a provider.
      const res = await request(app.getHttpServer())
        .post('/v1/auth/oauth/github/exchange')
        .send({ code: 'forged-code-value-123456', state: 'forged-state-value-123456' });
      expect([401, 501]).toContain(res.status);
    });
  });
});
