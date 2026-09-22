#!/usr/bin/env node
/**
 * Runs a distributed capacity benchmark: one real host publishing to a
 * real, already-deployed API/SFU fleet, and N containerized `worker.mjs`
 * shards — each its own `docker run`, each capable of pointing at a
 * different Docker context (i.e. a different physical machine over SSH)
 * — holding the audience. Where `run.mjs` answers "how many viewers can
 * one node serve," this answers docs/production/architecture-5k.md §4's
 * question: "does the harness itself scale past one machine's renderer
 * budget." It does not stand up an SFU or an API — point it at a real
 * deployment, e.g. the Azure fleet in `infrastructure/azure/`, or at a
 * locally-run one for a same-machine smoke test.
 *
 * Usage:
 *
 *   node coordinate.mjs \
 *     --api-url http://localhost:4100 \
 *     --workers 250,250,250 \
 *     --duration 300 --sample-interval 10 \
 *     --image raven/capacity-worker:dev
 *
 * `--worker-api-url` overrides the URL baked into each container when it
 * differs from `--api-url` — only needed for a same-machine smoke test,
 * where the coordinator's own Playwright host reaches the API at
 * `127.0.0.1` but a container needs `host.docker.internal` for the same
 * machine, since a container's own `127.0.0.1` is itself.
 *
 * `--workers` is a comma-separated list of `viewers[@dockerContext]`.
 * `250,250@remote-host,250@other-host` runs one shard on the local
 * Docker daemon and two on remote ones already registered with
 * `docker context create` — the real mechanism this repo has for
 * "run this container on a different machine" without inventing one.
 *
 * The published JSON shape matches `lib/report.mjs`'s existing rows
 * (`mediaAlivePercent`, `decodedFpsMean`, ...) plus a `workers[]` array
 * naming exactly which shard ran where, so a distributed result sits
 * next to `run.mjs tiers`' single-node ones in `results/` without a
 * second format to reconcile.
 */
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { diffSamples, summariseJoins } from './lib/analyse.mjs';
import { printTierRow, writeResult } from './lib/report.mjs';
import { Host, launchBrowser } from './lib/audience.mjs';
import { ensureContent } from './lib/content.mjs';
import { ControlPlane } from './lib/mint.mjs';
import { startHarnessServer } from './lib/stack.mjs';
import { stageHarnessSdk } from './build-harness-sdk.mjs';

const execFileAsync = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const HARNESS_DIR = join(HERE, 'harness');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const [key, inline] = arg.slice(2).split('=');
    out[key] = inline ?? (argv[i + 1]?.startsWith('--') ? 'true' : (argv[++i] ?? 'true'));
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const num = (key, fallback) => (args[key] == null ? fallback : Number(args[key]));

function parseWorkerSpecs(raw) {
  return raw.split(',').map((entry, index) => {
    const [countRaw, dockerContext] = entry.split('@');
    const count = Number(countRaw);
    if (!Number.isFinite(count) || count <= 0) throw new Error(`bad --workers entry "${entry}"`);
    return { index, viewers: count, dockerContext: dockerContext || null };
  });
}

/** Runs one worker container and waits for it to exit. Throws on non-zero exit. */
async function runWorkerContainer(
  spec,
  { image, workerApiUrl, apiKey, streamId, offset, duration, sampleInterval, outDir },
) {
  const workerId = `worker-${spec.index}`;
  const outFile = join(outDir, `${workerId}.json`);
  const dockerArgs = [
    ...(spec.dockerContext ? ['--context', spec.dockerContext] : []),
    'run',
    '--rm',
    // Makes host.docker.internal resolve even on Linux Docker hosts
    // (Docker Desktop already provides it). A no-op when --worker-api-url
    // names a routable host, which is the normal case once workers are
    // actually on separate machines — this only matters for the
    // same-machine smoke test.
    '--add-host=host.docker.internal:host-gateway',
    '-v',
    `${outDir}:/out`,
    '--name',
    `raven-capacity-${workerId}-${Date.now().toString(36)}`,
    image,
    '--api-url',
    workerApiUrl,
    '--api-key',
    apiKey,
    '--stream-id',
    streamId,
    '--viewers',
    String(spec.viewers),
    '--offset',
    String(offset),
    '--duration',
    String(duration),
    '--sample-interval',
    String(sampleInterval),
    '--worker-id',
    workerId,
    '--out',
    `/out/${workerId}.json`,
  ];
  console.log(
    `  · launching ${workerId} (${spec.viewers} viewers${spec.dockerContext ? `, context=${spec.dockerContext}` : ''})`,
  );
  const { stdout } = await execFileAsync('docker', dockerArgs, { maxBuffer: 64 * 1024 * 1024 });
  if (stdout.trim())
    console.log(
      stdout
        .trimEnd()
        .split('\n')
        .map((l) => `    ${l}`)
        .join('\n'),
    );
  return { workerId, outFile, spec };
}

async function main() {
  const apiUrl = args['api-url'];
  if (!apiUrl) throw new Error('--api-url is required (a running, real API — this script does not boot one)');
  // Almost always the same as --api-url: a distributed run's API is a
  // routable address any machine can reach. The one case it is not is a
  // same-machine smoke test with the coordinator's own Playwright host
  // talking to 127.0.0.1 while its worker containers need Docker's own
  // name for the host machine (host.docker.internal) instead, since a
  // container's 127.0.0.1 is itself, not the coordinator's.
  const workerApiUrl = args['worker-api-url'] ?? apiUrl;
  const image = args.image ?? 'raven/capacity-worker:dev';
  const workerSpecs = parseWorkerSpecs(args.workers ?? '50');
  const duration = num('duration', 120);
  const sampleInterval = num('sample-interval', 10);
  const profile = args.profile ?? '360p';
  const skipSdkBuild = args['skip-sdk-build'] === 'true';

  const runId = `dist-${Date.now().toString(36)}`;
  const outDir = mkdtempSync(join(tmpdir(), 'raven-capacity-'));
  mkdirSync(outDir, { recursive: true });

  console.log(
    `[coordinate] run ${runId}: ${workerSpecs.reduce((s, w) => s + w.viewers, 0)} viewers across ${workerSpecs.length} worker(s)`,
  );

  if (!skipSdkBuild) {
    console.log('[coordinate] staging harness SDK (host page needs it too)');
    stageHarnessSdk({ rebuild: true });
  }

  const control = new ControlPlane(apiUrl);
  await control.provision(runId);
  const stream = await control.createStream(`Distributed capacity ${runId}`, 'host');
  const hostCredential = await control.addHost(stream.id, 'host', 'HOST');
  await control.startStream(stream.id);
  console.log(`[coordinate] stream ${stream.id} live, project ${control.projectId}`);

  const harness = await startHarnessServer(HARNESS_DIR);
  // Same reasoning as Rig.up(): Chromium's default fake camera is a
  // rotating colour wheel that encodes at a fraction of real camera
  // bitrate (see README's "publish profile" note), so this generates the
  // same whole-frame-motion Y4M loop run.mjs's scenarios measure against.
  const videoFile = args.content === 'synthetic' ? undefined : await ensureContent(profile);
  const browser = await launchBrowser({ headless: args.headless !== 'false', videoFile });
  const host = new Host({
    browser,
    harnessUrl: harness.url,
    credentials: { streamId: stream.id, ...hostCredential, chatRootMessageId: stream.chatRootMessageId ?? null },
    profile,
    audio: true,
    onLog: (who, line) => {
      if (/error/i.test(line)) console.log(`[coordinate:${who}] ${line}`);
    },
  });

  let outcome;
  try {
    const hostState = await host.start();
    console.log(
      `[coordinate] host publishing ${hostState.capturedSettings?.width}x${hostState.capturedSettings?.height}@${hostState.capturedSettings?.frameRate}`,
    );

    // Sequential offsets so no two workers ever mint the same viewer
    // identity, whichever machine they land on.
    let offsetCursor = 0;
    const offsets = workerSpecs.map((spec) => {
      const offset = offsetCursor;
      offsetCursor += spec.viewers;
      return offset;
    });

    const launched = await Promise.all(
      workerSpecs.map((spec, i) =>
        runWorkerContainer(spec, {
          image,
          workerApiUrl,
          apiKey: control.apiKey,
          streamId: stream.id,
          offset: offsets[i],
          duration,
          sampleInterval,
          outDir,
        }),
      ),
    );

    const workerResults = launched.map(({ workerId, outFile, spec }) => ({
      workerId,
      dockerContext: spec.dockerContext,
      ...JSON.parse(readFileSync(outFile, 'utf8')),
    }));

    const totalRequested = workerResults.reduce((s, w) => s + w.requestedViewers, 0);
    const totalSeated = workerResults.reduce((s, w) => s + w.seatedViewers, 0);
    const totalRefusals = workerResults.reduce((s, w) => s + w.refusals.length, 0);
    console.log(
      `[coordinate] seated ${totalSeated}/${totalRequested} (${totalRefusals} mint refusal(s)) across ${workerResults.length} worker(s)`,
    );

    // Every worker samples on its own clock; "before" and "after" are
    // each worker's last two samples, pooled across workers rather than
    // requiring wall-clock alignment. diffSamples' gate is a per-viewer
    // interval, not a per-run one, so this is the same comparison
    // `run.mjs` makes, just assembled from N sample streams instead of
    // one. Deliberately not samples[0]: a worker's first sample is taken
    // the instant joinAll() returns, while ICE/DTLS is still
    // 'connecting' — every viewer's own first interval reads as
    // no-video-stats by construction, which is about join latency, not
    // about whether media stayed alive once seated.
    const before = workerResults.flatMap(
      (w) => (w.samples.length >= 2 ? w.samples.at(-2) : w.samples[0])?.viewers ?? [],
    );
    const after = workerResults.flatMap((w) => w.samples.at(-1)?.viewers ?? []);
    const media = diffSamples(before, after, {
      minIntervalMs: Math.min(1_000, sampleInterval * 500),
      expected: totalSeated,
    });
    const joins = summariseJoins(after);

    const row = {
      viewers: totalRequested,
      workers: workerResults.map((w) => ({
        workerId: w.workerId,
        dockerContext: w.dockerContext,
        requestedViewers: w.requestedViewers,
        seatedViewers: w.seatedViewers,
        refusals: w.refusals.length,
        shardLayout: w.shardLayout,
      })),
      ...joins,
      mediaAliveCount: media.mediaAliveCount,
      mediaAlivePercent: media.mediaAlivePercent,
      elementFramesStalledCount: media.elementFramesStalledCount,
      decodedFpsMean: media.decodedFpsMean,
      decodedFpsP05: media.decodedFpsP05,
      viewerInboundMbpsTotal: media.viewerInboundMbpsTotal,
      lossPercentMean: media.lossPercentMean,
      lossPercentP95: media.lossPercentP95,
      jitterMsMean: media.jitterMsMean,
      rttMsMean: media.rttMsMean,
      freezes: media.freezes,
      reconnects: media.reconnects,
      failureReasons: media.failureReasons,
      failures: media.perViewer.filter((v) => !v.mediaAlive).map((v) => ({ id: v.id, reason: v.reason })),
      resolutions: media.resolutions,
      distinctDockerContexts: [...new Set(workerSpecs.map((w) => w.dockerContext ?? 'local'))],
    };

    printTierRow(row);
    outcome = row;
  } finally {
    await host.close();
    await browser.close().catch(() => {});
    await new Promise((resolve) => harness.server.close(() => resolve()));
    await control.endStream(stream.id).catch((err) => console.error(`endStream: ${err.message}`));
    rmSync(outDir, { recursive: true, force: true });
  }

  const file = writeResult(`distributed-${runId}`, {
    scenario: 'distributed',
    runId,
    apiUrl,
    imageUsed: image,
    workerSpecs,
    durationSeconds: duration,
    ...outcome,
  });
  console.log(`\n[coordinate] wrote ${file}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
