#!/usr/bin/env node
/**
 * Phase 9: does running more API processes against one Postgres actually
 * buy more throughput, and what breaks first when it does not?
 *
 * # Why this and not the existing k6 rig
 *
 * `scripts/k6/api-load-test.js` with `docker-compose.scale.yml` already
 * scales the API horizontally, and it is the right tool for the ramp-
 * until-the-SLO-breaks question it was built for. It is the wrong tool
 * here for two reasons. It drives `POST /v1/rooms` and generic RTC
 * tokens, not the Live Streaming viewer-token mint, which is the
 * endpoint with the admission lane and the one whose single-process
 * ceiling `docs/production/capacity.md` publishes. And an
 * `abortOnFail` ramp answers "where does it break", where the question
 * for scaling efficiency is "how much does a fixed load cost at 1, 2 and
 * 3 processes" — the same work, three times, held constant.
 *
 * So: identical fixed load, three topologies, one shared Postgres and
 * Redis, connection accounting sampled from `pg_stat_activity` while the
 * load is in flight.
 *
 *   node api-scaling.mjs --instances 1,2,3 --requests 600 --concurrency 30
 */
import { Db } from './lib/db.mjs';
import { apiCall, ControlPlane } from './lib/mint.mjs';
import { ProcessTreeSampler } from './lib/proc.mjs';
import { writeResult } from './lib/report.mjs';
import { REPO } from './lib/rig.mjs';
import { ApiProcess, buildApi } from './lib/stack.mjs';
import { percentile } from './lib/analyse.mjs';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const [key, inline] = argv[i].slice(2).split('=');
    out[key] = inline ?? (argv[i + 1]?.startsWith('--') ? 'true' : (argv[++i] ?? 'true'));
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const INSTANCE_COUNTS = (args.instances ?? '1,2,3').split(',').map(Number);
const REQUESTS = Number(args.requests ?? 600);
const CONCURRENCY = Number(args.concurrency ?? 30);
const BASE_PORT = Number(args['base-port'] ?? 4801);

const dbUrl = process.env.CAPACITY_DATABASE_URL;
const redisUrl = process.env.CAPACITY_REDIS_URL ?? process.env.REDIS_URL;
if (!dbUrl || !redisUrl) {
  console.error('CAPACITY_DATABASE_URL and CAPACITY_REDIS_URL must be set.');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A fixed amount of work, spread round-robin over whichever instances are
 * up. Round-robin rather than random so the split is exact and a
 * difference between runs cannot be an artefact of an uneven draw.
 *
 * @param keyedStreams [{ apiKey, streamId }] — one per provisioned project.
 *   Round-robining requests across several keys, not just several API
 *   processes, is required here: `POST .../viewer-tokens` carries
 *   `@RateLimit(120)` keyed by API key (`rate-limit.guard.ts`), enforced
 *   through Redis and therefore identical however many API processes are
 *   running. A single key hits that ceiling at 120 requests regardless of
 *   instance count — which was this script's first bug: every one of
 *   1/2/3 instances "succeeded" at exactly 120/600, because the limiter,
 *   not the pool, was refusing the rest. That is the fleet-wide limiter
 *   working correctly, and it is a different, already-measured claim
 *   (`docs/production/capacity.md`'s per-key ceiling); it is not what
 *   Phase 9 is asking about. Enough keys that N × 120 clears `requests`
 *   moves the ceiling actually under test back to the database pool.
 */
async function driveMintLoad(baseUrls, keyedStreams, { requests, concurrency }) {
  const latencies = [];
  const statuses = new Map();
  const codes = new Map();
  let cursor = 0;
  const startedAt = Date.now();

  const worker = async (workerIndex) => {
    while (true) {
      const index = cursor++;
      if (index >= requests) return;
      const base = baseUrls[index % baseUrls.length];
      const { apiKey, streamId } = keyedStreams[index % keyedStreams.length];
      const at = performance.now();
      try {
        const res = await fetch(`${base}/v1/live-streams/${streamId}/viewer-tokens`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ identity: `scale-w${workerIndex}-i${index}` }),
          signal: AbortSignal.timeout(60_000),
        });
        const elapsed = performance.now() - at;
        latencies.push(elapsed);
        statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1);
        if (res.status !== 201) {
          const body = await res.json().catch(() => ({}));
          const code = body.code ?? body.error?.code ?? `http-${res.status}`;
          codes.set(code, (codes.get(code) ?? 0) + 1);
        }
      } catch (err) {
        latencies.push(performance.now() - at);
        statuses.set(0, (statuses.get(0) ?? 0) + 1);
        codes.set(
          err.name === 'TimeoutError' ? 'client-timeout' : 'network-error',
          (codes.get('network-error') ?? 0) + 1,
        );
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)));
  const wallMs = Date.now() - startedAt;

  const succeeded = statuses.get(201) ?? 0;
  const serverErrors = [...statuses].filter(([s]) => s >= 500 && s !== 503).reduce((sum, [, n]) => sum + n, 0);
  return {
    requests,
    concurrency,
    wallMs,
    throughputPerSecond: (succeeded / wallMs) * 1000,
    succeeded,
    rejected: requests - succeeded,
    // A 500 is the failure mode the admission work exists to prevent, so
    // it is counted apart from the coded 429/503 refusals, which are the
    // system working as designed.
    serverErrors,
    statuses: Object.fromEntries(statuses),
    codes: Object.fromEntries(codes),
    p50Ms: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
    p99Ms: percentile(latencies, 99),
    maxMs: latencies.length ? Math.max(...latencies) : null,
  };
}

async function main() {
  if (args['skip-api-build'] !== 'true') {
    console.log('building api…');
    await buildApi(REPO);
  }

  const db = new Db(dbUrl);
  const { maxConnections } = await db.connectionStats();
  const poolMax = Number(process.env.DATABASE_POOL_MAX ?? 10);
  console.log(`postgres max_connections=${maxConnections}, DATABASE_POOL_MAX=${poolMax}`);

  /**
   * All the keyed streams every iteration will need, minted once, up
   * front, through one throwaway API process.
   *
   * Two limiters shape this. `POST /v1/auth/register` carries
   * `@RateLimit(5)` keyed by IP — every rig request shares 127.0.0.1, so
   * registering once and creating additional projects under that account
   * (`provisionExtraProject`, uncapped) is required, not optional.
   * `POST .../viewer-tokens` carries `@RateLimit(120)` per key, so each
   * iteration needs its own unused batch: reusing a batch across
   * iterations would let the second iteration inherit whatever budget
   * the first had already spent in the same Redis window, understating
   * its throughput for a reason that has nothing to do with instance
   * count.
   */
  const keysPerIteration = Math.ceil(REQUESTS / 100);
  console.log(
    `minting ${keysPerIteration * INSTANCE_COUNTS.length} project/key pairs across ${INSTANCE_COUNTS.length} iteration(s)…`,
  );
  const bootstrapApi = new ApiProcess({
    repoRoot: REPO,
    port: BASE_PORT - 1,
    env: {
      DATABASE_URL: dbUrl,
      DIRECT_URL: dbUrl,
      REDIS_URL: redisUrl,
      SFU_REGISTRATION_SECRET: process.env.SFU_REGISTRATION_SECRET ?? 'capacity-rig-registration-secret',
      API_PUBLIC_URL: `http://127.0.0.1:${BASE_PORT - 1}`,
      DATABASE_POOL_MAX: String(poolMax),
    },
  });
  await bootstrapApi.start();
  const bootstrapControl = new ControlPlane(bootstrapApi.baseUrl);
  await bootstrapControl.provision(`scale-bootstrap-${Date.now().toString(36)}`);

  const allKeyedStreams = [];
  for (let k = 0; k < keysPerIteration * INSTANCE_COUNTS.length; k += 1) {
    const { apiKey } =
      k === 0
        ? { apiKey: bootstrapControl.apiKey }
        : await bootstrapControl.provisionExtraProject(`scale-${k}-${Date.now().toString(36)}`);
    const headers = { Authorization: `Bearer ${apiKey}` };
    const stream = await apiCall(bootstrapApi.baseUrl, '/v1/live-streams', {
      method: 'POST',
      body: { title: `API scaling key${k}`, hostIdentity: 'host' },
      headers,
    });
    await apiCall(bootstrapApi.baseUrl, `/v1/live-streams/${stream.id}/start`, { method: 'POST', headers });
    allKeyedStreams.push({ apiKey, streamId: stream.id });
  }
  await bootstrapApi.stop();

  const results = [];

  for (const instanceCount of INSTANCE_COUNTS) {
    console.log(`\n=== ${instanceCount} API process${instanceCount > 1 ? 'es' : ''} ===`);
    const instances = [];
    try {
      for (let i = 0; i < instanceCount; i += 1) {
        const api = new ApiProcess({
          repoRoot: REPO,
          port: BASE_PORT + i,
          env: {
            // See lib/rig.mjs: 'production' enables OAuth callback URL
            // validation, which a local rig cannot satisfy and which has
            // nothing to do with throughput.
            DATABASE_URL: dbUrl,
            DIRECT_URL: dbUrl,
            REDIS_URL: redisUrl,
            SFU_REGISTRATION_SECRET: process.env.SFU_REGISTRATION_SECRET ?? 'capacity-rig-registration-secret',
            API_PUBLIC_URL: `http://127.0.0.1:${BASE_PORT + i}`,
            DATABASE_POOL_MAX: String(poolMax),
          },
        });
        await api.start();
        instances.push(api);
        console.log(`  started ${api.baseUrl} (pid ${api.pid})`);
      }

      const baseUrls = instances.map((i) => i.baseUrl);

      // This iteration's own unused slice. Each key was minted once, up
      // front (see above), specifically so that this iteration's 120/
      // window budget hasn't been touched by any previous iteration's
      // requests against the same key.
      const keyedStreams = allKeyedStreams.splice(0, keysPerIteration);

      // Warm every instance: the first authenticated request on a cold
      // process pays a bcrypt comparison that the verify cache then
      // absorbs, and leaving it in would charge instance 2 and 3 for a
      // cost instance 1 had already paid in the warm-up of the run before.
      for (const base of baseUrls) {
        for (const { apiKey, streamId } of keyedStreams) {
          await fetch(`${base}/v1/live-streams/${streamId}`, { headers: { Authorization: `Bearer ${apiKey}` } });
        }
      }
      await sleep(1_000);

      const samplers = instances.map((api) => new ProcessTreeSampler(api.label, api.pid));
      for (const s of samplers) await s.sample();

      const connectionSamples = [];
      let sampling = true;
      const samplerLoop = (async () => {
        while (sampling) {
          connectionSamples.push({ at: Date.now(), ...(await db.connectionStats()) });
          await sleep(500);
        }
      })();

      const load = await driveMintLoad(baseUrls, keyedStreams, {
        requests: REQUESTS,
        concurrency: CONCURRENCY,
      });

      sampling = false;
      await samplerLoop;
      const processStats = await Promise.all(samplers.map((s) => s.sample()));

      const peakConnections = Math.max(...connectionSamples.map((s) => s.total));
      const row = {
        instances: instanceCount,
        ...load,
        peakPostgresConnections: peakConnections,
        postgresMaxConnections: maxConnections,
        poolMaxPerInstance: poolMax,
        poolCeiling: poolMax * instanceCount,
        // The number that actually bounds horizontal scaling. Exceeding
        // it is not a slowdown, it is a refused connection.
        withinPostgresLimit: peakConnections <= maxConnections,
        withinConfiguredPools: peakConnections <= poolMax * instanceCount + 5,
        cpuPercentPerInstance: processStats.map((s) => s.cpuPercent),
        rssMbPerInstance: processStats.map((s) => s.rssMb),
        connectionSamples: connectionSamples.length,
      };
      results.push(row);
      console.log(
        `  ${load.succeeded}/${load.requests} succeeded in ${load.wallMs}ms = ${load.throughputPerSecond.toFixed(1)}/s\n` +
          `  p50 ${load.p50Ms?.toFixed(0)}ms  p95 ${load.p95Ms?.toFixed(0)}ms  p99 ${load.p99Ms?.toFixed(0)}ms  500s: ${load.serverErrors}\n` +
          `  statuses ${JSON.stringify(load.statuses)}  codes ${JSON.stringify(load.codes)}\n` +
          `  peak pg connections ${peakConnections}/${maxConnections} (configured ceiling ${poolMax * instanceCount})\n` +
          `  cpu ${row.cpuPercentPerInstance.map((c) => (c == null ? '—' : c.toFixed(0))).join('/')}%  rss ${row.rssMbPerInstance.map((r) => r.toFixed(0)).join('/')}MB`,
      );
    } finally {
      for (const api of instances) await api.stop();
      await sleep(1_000);
    }
  }

  const single = results.find((r) => r.instances === 1);
  const efficiency = results.map((r) => ({
    instances: r.instances,
    throughputPerSecond: r.throughputPerSecond,
    speedupVsSingle: single ? r.throughputPerSecond / single.throughputPerSecond : null,
    scalingEfficiencyPercent: single ? (r.throughputPerSecond / single.throughputPerSecond / r.instances) * 100 : null,
    p95Ms: r.p95Ms,
    serverErrors: r.serverErrors,
    peakPostgresConnections: r.peakPostgresConnections,
  }));

  const file = writeResult(`api-scaling-${Date.now().toString(36)}`, {
    scenario: 'api-scaling',
    requests: REQUESTS,
    concurrency: CONCURRENCY,
    postgresMaxConnections: maxConnections,
    poolMax,
    results,
    efficiency,
  });
  console.log(`\n${JSON.stringify(efficiency, null, 2)}\n\nwritten: ${file}`);
  await db.close();
}

main().catch((err) => {
  console.error(err.stack ?? err.message);
  process.exit(1);
});
