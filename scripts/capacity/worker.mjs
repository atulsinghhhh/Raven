#!/usr/bin/env node
/**
 * One shard of a distributed capacity run: real Chromium, real viewer
 * credentials minted from a real (already-deployed) API, real
 * PeerConnections — but no stack of its own. `lib/rig.mjs`'s `Rig` boots
 * its own API and SFU so a single machine can measure a single node in
 * isolation; this is the opposite shape, built for
 * docs/production/architecture-5k.md §4: many of these, one per
 * container, pointed at one already-running fleet, so the audience is
 * genuinely distributed across hosts and renderers rather than sharded
 * across pages in one process.
 *
 * A worker owns exactly: a static server for the harness pages, a
 * browser, and a slice of the viewer identity space (`--offset` so two
 * workers never mint the same identity). It does not create the stream,
 * does not publish to it, and does not decide when the run ends — that
 * is `coordinate.mjs`'s job, run once per benchmark rather than once per
 * shard. A worker that could do all of that too would just be `Rig`
 * again, pointed at a remote API instead of a local one, and would
 * reintroduce the very thing distributing the load generator exists to
 * remove: one process deciding both when it is under load and whether it
 * is coping.
 *
 * Usage (see Dockerfile for the container form):
 *
 *   node worker.mjs \
 *     --api-url http://api.internal:4100 \
 *     --api-key <project api key> \
 *     --stream-id <live stream id> \
 *     --viewers 250 --offset 0 \
 *     --duration 300 --sample-interval 10 \
 *     --out /out/worker-0.json
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Audience, launchBrowser } from './lib/audience.mjs';
import { ControlPlane } from './lib/mint.mjs';
import { startHarnessServer } from './lib/stack.mjs';

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
const require = (key) => {
  if (!args[key]) throw new Error(`--${key} is required`);
  return args[key];
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const apiUrl = require('api-url');
  const apiKey = require('api-key');
  const streamId = require('stream-id');
  const viewers = num('viewers', 50);
  const offset = num('offset', 0);
  const durationSeconds = num('duration', 120);
  const sampleIntervalSeconds = num('sample-interval', 10);
  const perPage = num('per-page', 10);
  const staggerMs = num('stagger', 120);
  const chat = args.chat === 'true';
  const workerId = args['worker-id'] ?? `worker-${offset}`;
  const outPath = args.out ?? `./${workerId}.json`;

  console.log(`[${workerId}] minting ${viewers} viewer(s) at offset ${offset} against ${apiUrl}`);

  const control = new ControlPlane(apiUrl);
  control.apiKey = apiKey;

  const stream = await control.getStream(streamId);
  const chatRootMessageId = stream.chatRootMessageId ?? null;

  const identities = Array.from({ length: viewers }, (_, i) => `viewer-${workerId}-${offset + i}`);
  const minted = await control.mintViewerTokens(streamId, identities);
  const seats = [];
  const refusals = [];
  minted.forEach((result, i) => {
    if (!result.ok) {
      refusals.push({ identity: identities[i], status: result.status, code: result.code, message: result.message });
      return;
    }
    const credentials = { streamId, ...result.credentials, chatRootMessageId };
    if (!chat) delete credentials.chat;
    seats.push({ id: identities[i], credentials });
  });
  if (refusals.length) {
    console.log(`[${workerId}] ${refusals.length}/${viewers} mint refusal(s): ${JSON.stringify(refusals.slice(0, 3))}`);
  }

  const harness = await startHarnessServer(HARNESS_DIR);
  const browser = await launchBrowser({ headless: args.headless !== 'false' });

  const audience = new Audience({
    browser,
    harnessUrl: harness.url,
    seats,
    perPage,
    staggerMs,
    chat,
    onPageLog: (who, line) => {
      if (/error/i.test(line)) console.log(`[${workerId}:${who}] ${line}`);
    },
  });

  const samples = [];
  try {
    await audience.open();
    const joinWallMs = await audience.joinAll();
    console.log(
      `[${workerId}] ${seats.length} viewer(s) joined in ${joinWallMs}ms across ${audience.shards.length} shard(s)`,
    );

    const deadline = Date.now() + durationSeconds * 1000;
    samples.push({ at: Date.now(), viewers: await audience.sample() });
    while (Date.now() < deadline) {
      await sleep(Math.min(sampleIntervalSeconds * 1000, Math.max(0, deadline - Date.now())));
      samples.push({ at: Date.now(), viewers: await audience.sample() });
    }
  } finally {
    await audience.close();
    await browser.close().catch(() => {});
    await new Promise((resolve) => harness.server.close(() => resolve()));
  }

  const result = {
    workerId,
    apiUrl,
    streamId,
    requestedViewers: viewers,
    offset,
    seatedViewers: seats.length,
    refusals,
    shardLayout: audience.shardLayout,
    samples,
  };
  writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`[${workerId}] wrote ${outPath} (${samples.length} sample(s))`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
