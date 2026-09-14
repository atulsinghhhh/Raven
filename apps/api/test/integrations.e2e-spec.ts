import { INestApplication, ValidationPipe } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/shared/errors/all-exceptions.filter';
import { RedisService } from '../src/shared/redis/redis.service';

/**
 * The quickstart page's integration wizard, end to end: selecting a stack
 * persists, and "Test your integration" reflects real project state —
 * including flipping from pass to fail when the project's only API key is
 * revoked, not a cached or self-reported status.
 */
jest.setTimeout(30_000);

describe('Integrations (e2e)', () => {
  let app: INestApplication;
  const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const email = `integrations-e2e-${suffix}@raven.local`;
  const password = 'a-strong-password-123';

  let accessToken: string;
  let projectId: string;
  let keyId: string;

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

    const registerRes = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ email, password, name: 'Integrations Tester' });
    accessToken = registerRes.body.accessToken;

    const projectRes = await request(app.getHttpServer())
      .post('/v1/projects')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Integrations E2E Project' });
    projectId = projectRes.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports no verification checks before a key exists', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/projects/${projectId}/integrations/rtc/verify`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.success).toBe(false);
    expect(res.body.checks.find((c: { id: string }) => c.id === 'apiKey')).toMatchObject({ status: 'fail' });
  });

  it('saves a stack selection and lists it back', async () => {
    const selectRes = await request(app.getHttpServer())
      .patch(`/v1/projects/${projectId}/integrations/rtc`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ language: 'typescript', framework: 'nextjs' })
      .expect(200);

    expect(selectRes.body).toMatchObject({ product: 'RTC', language: 'typescript', framework: 'nextjs' });

    const listRes = await request(app.getHttpServer())
      .get(`/v1/projects/${projectId}/integrations`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0]).toMatchObject({ product: 'RTC', framework: 'nextjs' });
  });

  it('rejects an unknown product rather than guessing', async () => {
    await request(app.getHttpServer())
      .post(`/v1/projects/${projectId}/integrations/carrier-pigeon/verify`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(400);
  });

  it('passes the API key check once an active key exists, and persists the result', async () => {
    const keyRes = await request(app.getHttpServer())
      .post(`/v1/projects/${projectId}/api-keys`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Test key', environment: 'DEVELOPMENT' })
      .expect(201);
    keyId = keyRes.body.id;

    const verifyRes = await request(app.getHttpServer())
      .post(`/v1/projects/${projectId}/integrations/rtc/verify`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(verifyRes.body.checks.find((c: { id: string }) => c.id === 'apiKey')).toMatchObject({ status: 'pass' });

    const listRes = await request(app.getHttpServer())
      .get(`/v1/projects/${projectId}/integrations`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(listRes.body[0].lastVerifiedAt).not.toBeNull();
  });

  it('flips back to failing once the key is revoked — never a cached pass', async () => {
    await request(app.getHttpServer())
      .delete(`/v1/projects/${projectId}/api-keys/${keyId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);

    const verifyRes = await request(app.getHttpServer())
      .post(`/v1/projects/${projectId}/integrations/rtc/verify`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(verifyRes.body.success).toBe(false);
    expect(verifyRes.body.checks.find((c: { id: string }) => c.id === 'apiKey')).toMatchObject({ status: 'fail' });
  });
});
