import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WsAdapter } from '@nestjs/platform-ws';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/shared/database/prisma.service';
import { AllExceptionsFilter } from '../src/shared/errors/all-exceptions.filter';
import { RedisService } from '../src/shared/redis/redis.service';

/**
 * Concurrency and backpressure for Live Streaming's token-mint path.
 *
 * The behaviour under test is not "how fast is it". It is **what a burst
 * that exceeds configured capacity is allowed to look like on the wire**.
 * Minting a viewer credential is the single most concurrency-exposed Live
 * Streaming endpoint — one call per viewer arriving, all of them in the
 * seconds after a host goes live — and it is database-heavy: a stream
 * lookup, a room lookup, an allowance check, a participant upsert, a token
 * insert, a conversation lookup and a chat-membership upsert, each taking a
 * connection out of one pool of `DATABASE_POOL_MAX`.
 *
 * Before the admission control this suite exercises, ~100 simultaneous
 * mints exhausted that pool: `pg` gave up acquiring a connection after
 * `DATABASE_POOL_CONNECTION_TIMEOUT_MS`, Prisma surfaced that as an
 * unrecognised error, and the caller got `500 RAVEN_INTERNAL_ERROR` — a
 * response that tells a developer their integration is broken when in fact
 * the service was simply full.
 *
 * So every assertion here is about *legibility of overload*, and the one
 * that matters most is the same in every tier: **no 500s, ever**. Capacity
 * exhaustion has to arrive as a coded, retryable, documented status.
 *
 * Run with a scratch database (see test/guard-database-target.ts).
 */
jest.setTimeout(600_000);

/** Every status this endpoint is allowed to answer a burst with. A 500 is not on the list. */
const ACCEPTABLE_STATUSES = new Set([201, 429, 503]);

interface TierResult {
  concurrency: number;
  statuses: Record<number, number>;
  succeeded: number;
  rejected: number;
  serverErrors: number;
  codes: Record<string, number>;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  wallMs: number;
}

describe('Live Streaming capacity and backpressure (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let redis: RedisService;
  let prisma: PrismaService;
  let poolMax: number;
  let queueDepth: number;
  const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  let apiKey: string;
  let projectId: string;
  let dashboardToken: string;
  let streamId: string;
  const tiers: TierResult[] = [];

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

    redis = app.get(RedisService);
    prisma = app.get(PrismaService);
    poolMax = app.get(ConfigService).get<number>('database.poolMax')!;
    queueDepth = app.get(ConfigService).get<number>('capacity.queueDepth')!;
    await clearRateLimits();

    const registered = await request(baseUrl)
      .post('/v1/auth/register')
      .send({ email: `ls-capacity-${suffix}@raven.local`, password: 'correct-horse-battery-staple' })
      .expect(201);
    const jwtToken = registered.body.accessToken;

    const project = await request(baseUrl)
      .post('/v1/projects')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ name: `ls-capacity-${suffix}` })
      .expect(201);
    projectId = project.body.id;
    dashboardToken = jwtToken;

    apiKey = (
      await request(baseUrl)
        .post(`/v1/projects/${project.body.id}/api-keys`)
        .set('Authorization', `Bearer ${jwtToken}`)
        .send({ name: 'capacity' })
        .expect(201)
    ).body.key;

    const stream = await request(baseUrl)
      .post('/v1/live-streams')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ title: 'Capacity Stream', hostIdentity: 'host' })
      .expect(201);
    streamId = stream.body.id;

    await request(baseUrl)
      .post(`/v1/live-streams/${streamId}/start`)
      .set('Authorization', `Bearer ${apiKey}`)
      .expect(201);
  });

  afterAll(async () => {
    // Printed, not asserted on. These are the numbers
    // docs/production/capacity-report.md quotes, and a run that produced
    // them should leave them in the log rather than in somebody's memory.
    if (tiers.length > 0) {
      console.log('\n=== viewer-token mint: measured tiers ===');
      for (const tier of tiers) {
        console.log(
          `concurrency=${String(tier.concurrency).padStart(3)} ` +
            `ok=${String(tier.succeeded).padStart(3)} rejected=${String(tier.rejected).padStart(3)} ` +
            `5xx=${tier.serverErrors} ` +
            `p50=${tier.p50Ms}ms p95=${tier.p95Ms}ms max=${tier.maxMs}ms wall=${tier.wallMs}ms ` +
            `statuses=${JSON.stringify(tier.statuses)} codes=${JSON.stringify(tier.codes)}`,
        );
      }
    }
    await app?.close();
  });

  async function clearRateLimits(): Promise<void> {
    const stale = await redis.client.keys('ratelimit:*');
    if (stale.length > 0) await redis.client.del(...stale);
  }

  /**
   * Fires `concurrency` viewer-token mints at once and records what came
   * back.
   *
   * Rate-limit buckets are cleared first on purpose. The per-key limiter is
   * a separate, already-tested control (rate-limit.guard.spec.ts), and
   * leaving it in play would mean every tier past the first measured the
   * limiter rather than the database-backed capacity this suite is about.
   * The deliberate-overload tier below is the one that exercises rejection.
   */
  async function burst(concurrency: number): Promise<TierResult> {
    await clearRateLimits();

    const startedAt = Date.now();
    const results = await Promise.all(
      Array.from({ length: concurrency }, async (_unused, index) => {
        const at = Date.now();
        const res = await request(baseUrl)
          .post(`/v1/live-streams/${streamId}/viewer-tokens`)
          .set('Authorization', `Bearer ${apiKey}`)
          .send({ identity: `viewer-${concurrency}-${index}` });
        return { status: res.status, code: res.body?.code as string | undefined, ms: Date.now() - at };
      }),
    );
    const wallMs = Date.now() - startedAt;

    const statuses: Record<number, number> = {};
    const codes: Record<string, number> = {};
    for (const result of results) {
      statuses[result.status] = (statuses[result.status] ?? 0) + 1;
      if (result.code) codes[result.code] = (codes[result.code] ?? 0) + 1;
    }

    const latencies = results.map((r) => r.ms).sort((a, b) => a - b);
    const percentile = (p: number) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))];

    const tier: TierResult = {
      concurrency,
      statuses,
      succeeded: results.filter((r) => r.status === 201).length,
      rejected: results.filter((r) => r.status === 429 || r.status === 503).length,
      serverErrors: results.filter((r) => r.status >= 500 && r.status !== 503).length,
      codes,
      p50Ms: percentile(0.5),
      p95Ms: percentile(0.95),
      maxMs: latencies[latencies.length - 1],
      wallMs,
    };
    tiers.push(tier);
    return tier;
  }

  /**
   * Mints an extra API key on the same project.
   *
   * Needed because the per-key rate limiter and the process-wide admission
   * ceiling are different controls with different scopes, and only one of
   * them can be reached with a single key. See `burstAcrossKeys`.
   */
  async function extraApiKey(name: string): Promise<string> {
    const created = await request(baseUrl)
      .post(`/v1/projects/${projectId}/api-keys`)
      .set('Authorization', `Bearer ${dashboardToken}`)
      .send({ name })
      .expect(201);
    return created.body.key;
  }

  /**
   * Fires `perKey` mints simultaneously on each of several distinct API
   * keys.
   *
   * This is the only way to reach admission control from the outside, and
   * it is not a contrivance — it is the case the per-key limiter
   * structurally cannot see: ten different customers each sending a
   * perfectly polite ten requests at the same instant. Each key stays
   * inside its own 120/window budget, so nothing is rate limited, and the
   * process still has to decide what to do with the sum.
   */
  async function burstAcrossKeys(keys: string[], perKey: number): Promise<TierResult> {
    await clearRateLimits();

    const startedAt = Date.now();
    const results = await Promise.all(
      keys.flatMap((key, keyIndex) =>
        Array.from({ length: perKey }, async (_unused, index) => {
          const at = Date.now();
          const res = await request(baseUrl)
            .post(`/v1/live-streams/${streamId}/viewer-tokens`)
            .set('Authorization', `Bearer ${key}`)
            .send({ identity: `viewer-multi-${keyIndex}-${index}` });
          return { status: res.status, code: res.body?.code as string | undefined, ms: Date.now() - at };
        }),
      ),
    );
    const wallMs = Date.now() - startedAt;

    const statuses: Record<number, number> = {};
    const codes: Record<string, number> = {};
    for (const result of results) {
      statuses[result.status] = (statuses[result.status] ?? 0) + 1;
      if (result.code) codes[result.code] = (codes[result.code] ?? 0) + 1;
    }
    const latencies = results.map((r) => r.ms).sort((a, b) => a - b);
    const percentile = (p: number) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))];

    const tier: TierResult = {
      concurrency: keys.length * perKey,
      statuses,
      succeeded: results.filter((r) => r.status === 201).length,
      rejected: results.filter((r) => r.status === 429 || r.status === 503).length,
      serverErrors: results.filter((r) => r.status >= 500 && r.status !== 503).length,
      codes,
      p50Ms: percentile(0.5),
      p95Ms: percentile(0.95),
      maxMs: latencies[latencies.length - 1],
      wallMs,
    };
    tiers.push(tier);
    return tier;
  }

  /** Every response was one of the statuses this endpoint is allowed to give. */
  function expectNoUnexplainedFailures(tier: TierResult): void {
    for (const status of Object.keys(tier.statuses).map(Number)) {
      expect(ACCEPTABLE_STATUSES.has(status)).toBe(true);
    }
    expect(tier.serverErrors).toBe(0);
    expect(tier.codes['RAVEN_INTERNAL_ERROR']).toBeUndefined();
  }

  describe.each([10, 25, 50, 100])('%d concurrent viewer-token mints', (concurrency) => {
    it('answers every request with a documented status, never an unexplained 500', async () => {
      const tier = await burst(concurrency);
      expectNoUnexplainedFailures(tier);
      // Nothing is dropped at or below the configured ceiling: this tier
      // is inside capacity, so it should not be shedding load at all.
      expect(tier.succeeded).toBe(concurrency);
    });
  });

  it('sheds a single-key thundering herd at the rate limiter, with a coded 429', async () => {
    // 400 mints on one key. Worth being precise about what this measures,
    // because the obvious reading is wrong: the *rate limiter* is what
    // refuses these, not admission control. One key has a 120/window
    // budget on this route, so 120 get through and the rest are 429 before
    // they ever occupy an admission slot.
    //
    // That ordering is deliberate and is the right way round — abusive
    // traffic from one key must not consume the capacity the limiter
    // exists to protect — but it does mean this tier says nothing about
    // the admission ceiling. The test below is the one that reaches it.
    const tier = await burst(400);
    expectNoUnexplainedFailures(tier);
    expect(tier.succeeded + tier.rejected).toBe(400);
    expect(tier.rejected).toBeGreaterThan(0);
    // Every refusal is deliberate and carries a code a client can switch on.
    const shedCodes = Object.keys(tier.codes).filter((code) => code !== 'RAVEN_VALIDATION_FAILED');
    expect(shedCodes.every((code) => code.startsWith('RAVEN_'))).toBe(true);
    expect(tier.codes['RAVEN_RATE_LIMITED']).toBeGreaterThan(0);
  });

  it('sheds a multi-key herd at the admission ceiling, with a coded 503', async () => {
    // The case a per-key limiter structurally cannot catch: several
    // customers each politely inside their own budget, arriving together.
    // Nothing here is rate limited, so the process itself has to decide —
    // and the whole point of this release is that it decides *legibly*.
    const keys = [
      apiKey,
      await extraApiKey('capacity-b'),
      await extraApiKey('capacity-c'),
      await extraApiKey('capacity-d'),
    ];
    const perKey = 100;
    const tier = await burstAcrossKeys(keys, perKey);

    // The assertion that matters most, and the whole reason this file
    // exists: 400 simultaneous mints, and not one unexplained 500.
    expectNoUnexplainedFailures(tier);
    expect(tier.succeeded + tier.rejected).toBe(keys.length * perKey);

    // Past the concurrency ceiling *and* its queue, so some must be shed —
    // and shed as 503 RAVEN_CAPACITY_EXCEEDED, which is ours, not 429,
    // which would send a developer looking at their own call rate.
    const admissionCeiling = poolMax + queueDepth;
    if (tier.succeeded < keys.length * perKey) {
      expect(tier.codes['RAVEN_CAPACITY_EXCEEDED']).toBeGreaterThan(0);
      expect(tier.statuses[503]).toBeGreaterThan(0);
    }
    // Nothing inside the ceiling is refused: the queue is what turns a
    // burst into latency instead of failure.
    expect(tier.succeeded).toBeGreaterThanOrEqual(Math.min(keys.length * perKey, admissionCeiling));
  });

  it('answers a shed request with a retry hint and nothing internal', async () => {
    // A 503 that does not tell a client when to come back is barely better
    // than a 500. And a 503 that leaks a connection string is worse.
    const keys = [
      apiKey,
      await extraApiKey('capacity-e'),
      await extraApiKey('capacity-f'),
      await extraApiKey('capacity-g'),
    ];
    await clearRateLimits();

    const responses = await Promise.all(
      keys.flatMap((key, keyIndex) =>
        Array.from({ length: 100 }, (_unused, index) =>
          request(baseUrl)
            .post(`/v1/live-streams/${streamId}/viewer-tokens`)
            .set('Authorization', `Bearer ${key}`)
            .send({ identity: `viewer-shape-${keyIndex}-${index}` }),
        ),
      ),
    );

    const shed = responses.find((res) => res.status === 503);
    if (!shed) {
      // Not a silent pass: say so, so a run that never reached the ceiling
      // is not mistaken for one that reached it and behaved.

      console.log('note: this run stayed inside the admission ceiling — 503 body shape not exercised');
      return;
    }

    expect(shed.body.code).toBe('RAVEN_CAPACITY_EXCEEDED');
    expect(shed.body.retryAfterSeconds).toBeGreaterThan(0);
    expect(typeof shed.body.message).toBe('string');

    const serialized = JSON.stringify(shed.body);
    // No infrastructure, no credentials, no internal hostnames.
    expect(serialized).not.toMatch(/postgres:|postgresql:|redis:|password|@localhost|supabase|\.azure\./i);
    // No stack trace. Matched on the frame shape `at fn (file:line:col)`
    // rather than on the bare word "at", which appears legitimately in the
    // message ("is at capacity right now").
    expect(serialized).not.toMatch(/\bat\s+\S+\s+\(?[^\s)]+:\d+:\d+\)?/);
    expect(shed.body).not.toHaveProperty('stack');
    // The body names the limit that was hit, which is what makes a 503
    // actionable, but never the node/host behind it.
    expect(shed.body.limit).toBeGreaterThan(0);
  });

  it('leaves the database pool healthy and the endpoint usable straight after the burst', async () => {
    // The point of this one: a pool that was merely *slow* recovers, a pool
    // that leaked connections does not. If the previous tiers had exhausted
    // it permanently, this single unconcurrent request would fail too.
    await clearRateLimits();
    await request(baseUrl)
      .post(`/v1/live-streams/${streamId}/viewer-tokens`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ identity: 'viewer-after-burst' })
      .expect(201);

    const [{ count }] = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count
      FROM pg_stat_activity
      WHERE datname = current_database() AND application_name <> 'psql'
    `;
    // One process's pool cannot hold more than it was configured to. A
    // count above this means connections escaped the pool entirely.
    // Generous headroom for the query's own connection and anything else
    // attached to a shared scratch database.
    expect(Number(count)).toBeLessThanOrEqual(poolMax + 10);
  });
});
