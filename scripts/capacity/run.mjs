#!/usr/bin/env node
/**
 * Livqeno Live Streaming media-capacity rig.
 *
 * Every scenario below produces numbers from one run of one real stack:
 * a real API process, a real Go SFU, real Chromium viewers holding real
 * PeerConnections, and media judged alive only when frames are actually
 * being decoded. Nothing here is extrapolated and nothing is defaulted —
 * a measurement that could not be taken is reported as null and shows up
 * in the tables as an em dash.
 *
 *   node run.mjs tiers        --tiers 10,25,50,75,100 --hold 60
 *   node run.mjs sustained    --viewers 50 --minutes 30
 *   node run.mjs churn        --viewers 50 --cycles 6
 *   node run.mjs restart-api  --viewers 25
 *   node run.mjs restart-sfu  --viewers 25
 *   node run.mjs network      --viewers 10
 *   node run.mjs soak         --viewers 50 --minutes 120
 */
import { diffSamples, summariseJoins } from './lib/analyse.mjs';
import { printTierRow, tierTable, writeResult } from './lib/report.mjs';
import { Rig, sleep } from './lib/rig.mjs';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const [key, inline] = arg.slice(2).split('=');
      const value = inline ?? (argv[i + 1]?.startsWith('--') ? 'true' : (argv[++i] ?? 'true'));
      out[key] = value;
    } else {
      out._.push(arg);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const scenario = args._[0];
const num = (key, fallback) => (args[key] == null ? fallback : Number(args[key]));
const flag = (key, fallback = false) => (args[key] == null ? fallback : args[key] !== 'false');

/**
 * Takes two observations `gapMs` apart and reduces them to one row.
 *
 * Two, always — a single observation cannot tell a decoding viewer from a
 * frozen one, which is the entire point of the exercise.
 */
async function measureWindow(rig, gapMs = 6_000, expected) {
  const before = await rig.observe();
  await sleep(gapMs);
  const after = await rig.observe();
  const media = diffSamples(before.viewers, after.viewers, { minIntervalMs: Math.min(1_000, gapMs / 2), expected });
  const joins = summariseJoins(after.viewers);
  return { before, after, media, joins };
}

function flattenRow(viewers, { after, media, joins }, extra = {}) {
  return {
    viewers,
    ...joins,
    mediaAliveCount: media.mediaAliveCount,
    mediaAlivePercent: media.mediaAlivePercent,
    elementFramesStalledCount: media.elementFramesStalledCount,
    decodedFpsMean: media.decodedFpsMean,
    decodedFpsP05: media.decodedFpsP05,
    viewerInboundKbpsMean: media.viewerInboundKbpsMean,
    viewerInboundMbpsTotal: media.viewerInboundMbpsTotal,
    lossPercentMean: media.lossPercentMean,
    lossPercentP95: media.lossPercentP95,
    jitterMsMean: media.jitterMsMean,
    jitterMsP95: media.jitterMsP95,
    rttMsMean: media.rttMsMean,
    rttMsP95: media.rttMsP95,
    freezes: media.freezes,
    reconnects: media.reconnects,
    failureReasons: media.failureReasons,
    // The counts alone cannot be acted on. A tier that loses six viewers
    // needs to say whether they were refused, timed out gathering ICE,
    // or joined and then stopped decoding — three different findings.
    failures: media.perViewer
      .filter((v) => !v.mediaAlive)
      .map((v) => ({ id: v.id, reason: v.reason, connectionState: v.connectionState ?? null, error: v.error ?? null })),
    resolutions: media.resolutions,
    outboundMbps: after.sfu.rates?.outboundMbps ?? null,
    inboundMbps: after.sfu.rates?.inboundMbps ?? null,
    sfuCpuPercent: after.sfu.rates?.cpuPercent ?? null,
    sfuRssMb: after.sfu.rates?.rssMb ?? null,
    sfuHeapMb: after.sfu.rates?.heapMb ?? null,
    goroutines: after.sfu.rates?.goroutines ?? null,
    sfuParticipants: after.sfu.rates?.activeParticipants ?? null,
    sfuVideoTracks: after.sfu.rates?.activeVideoTracks ?? null,
    sfuOpenFds: after.sfu.rates?.openFds ?? null,
    sfuPacketsDroppedPerSec: after.sfu.rates?.packetsDroppedPerSec ?? null,
    apiCpuPercent: after.processes.api.cpuPercent,
    apiRssMb: after.processes.api.rssMb,
    browserCpuPercent: after.processes.browser.cpuPercent,
    browserRssMb: after.processes.browser.rssMb,
    shardLayout: after.shardLayout,
    load1: after.system.load1,
    cores: after.system.cores,
    saturated: after.system.saturated,
    redisRoomParticipants: after.redis.roomParticipants,
    redisSignalingKeys: after.redis.signalingKeys,
    hostSend: after.hostSend,
    ...extra,
  };
}

function baseOptions() {
  return {
    profile: args.profile ?? '360p',
    perPage: num('per-page', 10),
    staggerMs: num('stagger', 120),
    maxParticipants: num('max-participants', 250),
    allowBusy: flag('allow-busy'),
    maxBaselineLoad: args['max-baseline-load'] == null ? undefined : Number(args['max-baseline-load']),
    skipSdkBuild: flag('skip-sdk-build'),
    skipApiBuild: flag('skip-api-build'),
    headless: flag('headless', true),
  };
}

async function withRig(fn) {
  const rig = new Rig(baseOptions());
  let outcome;
  try {
    await rig.up();
    outcome = await fn(rig);
  } finally {
    await rig.down().catch((err) => console.error(`teardown: ${err.message}`));
  }
  return outcome;
}

/* ------------------------------------------------------------------ */

async function tiers() {
  const wanted = (args.tiers ?? '10,25,50,75,100').split(',').map(Number);
  const holdSeconds = num('hold', 60);
  const rows = [];

  return withRig(async (rig) => {
    await rig.openStream({ profile: baseOptions().profile });

    // One stream, one host, an audience that grows. Tearing the stream
    // down between tiers would measure a cold SFU each time and hide
    // exactly the accumulation — goroutines, heap, file descriptors —
    // that a capacity ceiling is usually made of.
    let seated = 0;
    for (const target of wanted) {
      const delta = target - seated;
      if (delta <= 0) continue;
      const { seats, refusals } = await rig.mintSeats(delta, seated);
      if (refusals.length) rig.note('mint.refused', { message: `${refusals.length} of ${delta}` });

      if (!rig.audience) {
        await rig.seatAudience(seats);
      } else {
        const startedAt = Date.now();
        await rig.audience.add(seats);
        rig.note('audience.grew', { message: `+${seats.length} to ${target} in ${Date.now() - startedAt}ms` });
      }
      seated = target;

      rig.note('tier.settling', { message: `${target} viewers, holding ${holdSeconds}s` });
      await sleep(holdSeconds * 1000);

      const window = await measureWindow(rig, 8_000, target);
      const row = flattenRow(target, window, { mintRefusals: refusals, holdSeconds });
      rows.push(row);
      printTierRow(row);

      if (row.mediaAlivePercent < 90) {
        rig.note('tier.degraded', {
          message: `${row.mediaAlivePercent.toFixed(1)}% media at ${target} viewers — stopping the ramp`,
        });
        // The tail of both processes' logs, kept with the result. A
        // degradation with no explanation is not a finding, and the
        // explanation is almost always something one of them said.
        row.sfuLogTail = rig.sfu.logs(80);
        row.apiLogTail = rig.api.logs(80);
        row.pageLogTail = rig.pageLogSink.slice(-80).join('\n');
        break;
      }
    }

    const file = writeResult(`tiers-${rig.runId}`, {
      runId: rig.runId,
      scenario: 'tiers',
      options: baseOptions(),
      rows,
      events: rig.events,
    });
    console.log(`\n${tierTable(rows)}\n\nwritten: ${file}`);
    return rows;
  });
}

async function sustained() {
  const viewers = num('viewers', 50);
  const minutes = num('minutes', 30);
  const sampleEverySeconds = num('sample-every', 30);

  return withRig(async (rig) => {
    await rig.openStream();
    const { seats, refusals } = await rig.mintSeats(viewers);
    await rig.seatAudience(seats, { chat: flag('chat') });

    const timeline = [];
    const endAt = Date.now() + minutes * 60_000;
    let previous = await rig.observe();
    let index = 0;

    while (Date.now() < endAt) {
      await sleep(sampleEverySeconds * 1000);
      const current = await rig.observe();
      const media = diffSamples(previous.viewers, current.viewers, { minIntervalMs: 1_000, expected: viewers });
      const row = flattenRow(
        viewers,
        { after: current, media, joins: summariseJoins(current.viewers) },
        {
          elapsedMinutes: Number(((Date.now() - (endAt - minutes * 60_000)) / 60_000).toFixed(2)),
        },
      );
      timeline.push(row);
      previous = current;
      index += 1;
      if (index % 4 === 0 || index === 1) printTierRow(row);
    }

    const drift = degradationReport(timeline);
    const file = writeResult(`sustained-${viewers}v-${minutes}m-${rig.runId}`, {
      runId: rig.runId,
      scenario: 'sustained',
      viewers,
      minutes,
      mintRefusals: refusals,
      timeline,
      drift,
      events: rig.events,
    });
    console.log(`\n${JSON.stringify(drift, null, 2)}\n\nwritten: ${file}`);
    return { timeline, drift };
  });
}

/** First-quarter vs last-quarter comparison. A soak's finding is a trend, not a final value. */
function degradationReport(timeline) {
  if (timeline.length < 4) return { note: 'too few samples to report a trend' };
  const quarter = Math.max(1, Math.floor(timeline.length / 4));
  const head = timeline.slice(0, quarter);
  const tail = timeline.slice(-quarter);
  const avg = (rows, key) => {
    const values = rows.map((r) => r[key]).filter((v) => typeof v === 'number' && !Number.isNaN(v));
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  };
  const compare = (key) => {
    const first = avg(head, key);
    const last = avg(tail, key);
    return {
      first,
      last,
      delta: first == null || last == null ? null : last - first,
      percentChange: first == null || last == null || first === 0 ? null : ((last - first) / first) * 100,
    };
  };
  return {
    samples: timeline.length,
    mediaAliveCount: compare('mediaAliveCount'),
    decodedFpsMean: compare('decodedFpsMean'),
    lossPercentMean: compare('lossPercentMean'),
    jitterMsMean: compare('jitterMsMean'),
    rttMsMean: compare('rttMsMean'),
    sfuRssMb: compare('sfuRssMb'),
    sfuHeapMb: compare('sfuHeapMb'),
    goroutines: compare('goroutines'),
    sfuOpenFds: compare('sfuOpenFds'),
    sfuCpuPercent: compare('sfuCpuPercent'),
    apiRssMb: compare('apiRssMb'),
    outboundMbps: compare('outboundMbps'),
    redisSignalingKeys: compare('redisSignalingKeys'),
    totalReconnects: timeline.reduce((sum, r) => sum + (r.reconnects ?? 0), 0),
    totalFreezes: timeline.reduce((sum, r) => sum + (r.freezes ?? 0), 0),
  };
}

async function churn() {
  const viewers = num('viewers', 50);
  const cycles = num('cycles', 6);
  const leaveCount = num('leave', 10);
  const killCount = num('kill', 5);

  return withRig(async (rig) => {
    await rig.openStream();
    const { seats } = await rig.mintSeats(viewers);
    await rig.seatAudience(seats);
    await sleep(20_000);

    const baseline = await measureWindow(rig, 8_000, viewers);
    const baselineRow = flattenRow(viewers, baseline, { phase: 'baseline' });
    printTierRow(baselineRow);

    const cycleRows = [baselineRow];
    let nextIdentity = viewers;
    let population = seats.map((s) => s.id);

    for (let cycle = 1; cycle <= cycles; cycle += 1) {
      // Clean leaves. These are the ones that fire live_stream.viewer_left
      // and are expected to clear the Redis roster promptly.
      const leaving = population.slice(0, leaveCount);
      await rig.audience.leave(leaving);
      population = population.slice(leaveCount);

      // Abrupt disconnects. No leave message reaches the server; the
      // socket simply stops. The roster is expected to clear these too,
      // via the heartbeat sweep rather than promptly.
      const killing = population.slice(0, killCount);
      await rig.audience.kill(killing);
      population = population.slice(killCount);

      await sleep(3_000);

      const replacements = await rig.mintSeats(leaveCount + killCount, nextIdentity);
      nextIdentity += leaveCount + killCount;
      await rig.audience.add(replacements.seats);
      population = population.concat(replacements.seats.map((s) => s.id));

      await sleep(15_000);
      const window = await measureWindow(rig, 8_000, population.length);
      const dbRows = await rig.db.participantsForRoom(rig.roomId);
      const duplicates = dbRows.filter((r) => r.sessions > 1);
      const row = flattenRow(population.length, window, {
        phase: `cycle-${cycle}`,
        left: leaveCount,
        killed: killCount,
        joined: replacements.seats.length,
        distinctIdentitiesInDb: dbRows.length,
        duplicateSessionRows: duplicates,
        mintRefusals: replacements.refusals,
      });
      cycleRows.push(row);
      printTierRow(row);
      if (duplicates.length)
        rig.note('invariant.violated', { message: `duplicate participant sessions: ${JSON.stringify(duplicates)}` });
    }

    const file = writeResult(`churn-${viewers}v-${rig.runId}`, {
      runId: rig.runId,
      scenario: 'churn',
      viewers,
      cycles,
      rows: cycleRows,
      drift: degradationReport(cycleRows),
      events: rig.events,
    });
    console.log(`\nwritten: ${file}`);
    return cycleRows;
  });
}

async function restartApi() {
  const viewers = num('viewers', 25);
  return withRig(async (rig) => {
    await rig.openStream();
    const { seats } = await rig.mintSeats(viewers);
    await rig.seatAudience(seats);
    await sleep(20_000);

    const before = await measureWindow(rig, 8_000, viewers);
    printTierRow(flattenRow(viewers, before, { phase: 'before-restart' }));

    rig.note('api.restart', {});
    const restartMs = await rig.api.restart();
    rig.note('api.restarted', { message: `${restartMs}ms` });

    // Recovery is not instant and should not be asserted as if it were.
    // Sampled repeatedly so the report can state how long it took rather
    // than only whether it happened.
    const recovery = [];
    const recoveryDeadline = Date.now() + 120_000;
    let recoveredAtMs = null;
    while (Date.now() < recoveryDeadline) {
      const window = await measureWindow(rig, 5_000, viewers);
      const row = flattenRow(viewers, window, {
        phase: 'recovering',
        sinceRestartMs: Date.now() - (Date.now() - restartMs),
      });
      recovery.push(row);
      if (row.mediaAliveCount >= Math.floor(viewers * 0.9)) {
        recoveredAtMs = recovery.length * 5_000;
        break;
      }
      await sleep(5_000);
    }

    // A brand-new viewer after the restart is the sharper test: it needs
    // the fresh API process to find the room's existing SFU assignment
    // and the publisher state that goes with it.
    const fresh = await rig.mintSeats(3, viewers + 500);
    await rig.audience.add(fresh.seats);
    await sleep(20_000);
    const afterFresh = await measureWindow(rig, 8_000, viewers + fresh.seats.length);
    const freshIds = new Set(fresh.seats.map((s) => s.id));
    const freshVerdicts = afterFresh.media.perViewer.filter((v) => freshIds.has(v.id));

    const dbRows = await rig.db.participantsForRoom(rig.roomId);
    const result = {
      runId: rig.runId,
      scenario: 'restart-api',
      viewers,
      restartMs,
      before: flattenRow(viewers, before, { phase: 'before' }),
      recovery,
      recoveredAtMs,
      afterFresh: flattenRow(viewers + fresh.seats.length, afterFresh, { phase: 'after-fresh-joins' }),
      freshViewerVerdicts: freshVerdicts,
      newViewersReceivingMedia: freshVerdicts.filter((v) => v.mediaAlive).length,
      duplicateSessionRows: dbRows.filter((r) => r.sessions > 1),
      hostState: await rig.host.state_(),
      mintRefusals: fresh.refusals,
      events: rig.events,
    };
    console.log(`\nwritten: ${writeResult(`restart-api-${viewers}v-${rig.runId}`, result)}`);
    printTierRow(result.afterFresh);
    return result;
  });
}

async function restartSfu() {
  const viewers = num('viewers', 25);
  return withRig(async (rig) => {
    await rig.openStream();
    const { seats } = await rig.mintSeats(viewers);
    await rig.seatAudience(seats);
    await sleep(20_000);

    const before = await measureWindow(rig, 8_000, viewers);
    printTierRow(flattenRow(viewers, before, { phase: 'before-restart' }));

    rig.note('sfu.restart', { message: 'SIGKILL — a node that dies does not deregister first' });
    const killedAt = Date.now();
    await rig.sfu.hardRestart(() => rig.isSfuRegistered());
    const backUpMs = Date.now() - killedAt;
    rig.note('sfu.restarted', { message: `${backUpMs}ms to registered` });

    const recovery = [];
    let recoveredAtMs = null;
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      const window = await measureWindow(rig, 5_000, viewers);
      const row = flattenRow(viewers, window, { phase: 'recovering', sinceKillMs: Date.now() - killedAt });
      recovery.push(row);
      if (row.mediaAliveCount > 0 && recoveredAtMs == null) recoveredAtMs = Date.now() - killedAt;
      if (row.mediaAliveCount >= Math.floor(viewers * 0.9)) break;
      await sleep(5_000);
    }

    const fresh = await rig.mintSeats(3, viewers + 500);
    await rig.audience.add(fresh.seats);
    await sleep(20_000);
    const afterFresh = await measureWindow(rig, 8_000, viewers + fresh.seats.length);
    const freshIds = new Set(fresh.seats.map((s) => s.id));

    const last = recovery[recovery.length - 1];
    const result = {
      runId: rig.runId,
      scenario: 'restart-sfu',
      viewers,
      backUpMs,
      firstMediaAfterRestartMs: recoveredAtMs,
      viewersRecovered: last?.mediaAliveCount ?? 0,
      viewersRecoveredPercent: last ? (last.mediaAliveCount / viewers) * 100 : 0,
      before: flattenRow(viewers, before, { phase: 'before' }),
      recovery,
      afterFresh: flattenRow(viewers + fresh.seats.length, afterFresh, { phase: 'after-fresh-joins' }),
      newViewersReceivingMedia: afterFresh.media.perViewer.filter((v) => freshIds.has(v.id) && v.mediaAlive).length,
      newViewersAttempted: fresh.seats.length,
      mintRefusals: fresh.refusals,
      staleRedisParticipants: await rig.redis.roomParticipantCount(rig.roomId),
      duplicateSessionRows: (await rig.db.participantsForRoom(rig.roomId)).filter((r) => r.sessions > 1),
      events: rig.events,
    };
    console.log(`\nwritten: ${writeResult(`restart-sfu-${viewers}v-${rig.runId}`, result)}`);
    printTierRow(result.afterFresh);
    return result;
  });
}

/**
 * Phase 12: the recommended capacity, held for as long as practical, with
 * the traffic a real stream actually has — chat, and an audience that
 * comes and goes rather than one that joined once and sat still.
 *
 * A plain `sustained` run at the recommended number already proved there
 * is no leak under a *static* audience. A soak's job is different: it
 * asks whether ordinary churn, repeated for hours instead of the six
 * cycles the churn scenario runs, is what eventually reveals a leak that
 * a static audience never would — a downtrack that isn't released, a
 * goroutine per departed viewer, a growing Redis key count that never
 * comes back down. So this is `sustained`'s sampling loop with `churn`'s
 * leave/kill/replace injected on a fixed interval throughout, not either
 * scenario alone.
 */
async function soak() {
  const viewers = num('viewers', 50);
  const minutes = num('minutes', 120);
  const sampleEverySeconds = num('sample-every', 30);
  const churnEveryMinutes = num('churn-every', 10);
  const leaveCount = num('leave', 5);
  const killCount = num('kill', 5);

  return withRig(async (rig) => {
    await rig.openStream();
    const { seats, refusals } = await rig.mintSeats(viewers);
    await rig.seatAudience(seats, { chat: true });

    let population = seats.map((s) => s.id);
    let nextIdentity = viewers;
    let churnCycles = 0;
    const churnLog = [];

    const timeline = [];
    const startedAt = Date.now();
    const endAt = startedAt + minutes * 60_000;
    let nextChurnAt = startedAt + churnEveryMinutes * 60_000;
    let previous = await rig.observe();
    let index = 0;

    while (Date.now() < endAt) {
      await sleep(sampleEverySeconds * 1000);

      if (Date.now() >= nextChurnAt && Date.now() < endAt) {
        churnCycles += 1;
        const leaving = population.slice(0, leaveCount);
        await rig.audience.leave(leaving);
        population = population.slice(leaveCount);
        const killing = population.slice(0, killCount);
        await rig.audience.kill(killing);
        population = population.slice(killCount);
        await sleep(3_000);

        const replacements = await rig.mintSeats(leaveCount + killCount, nextIdentity);
        nextIdentity += leaveCount + killCount;
        await rig.audience.add(replacements.seats);
        population = population.concat(replacements.seats.map((s) => s.id));

        const dbRows = await rig.db.participantsForRoom(rig.roomId);
        const duplicates = dbRows.filter((r) => r.sessions > 1);
        churnLog.push({
          cycle: churnCycles,
          atMinute: Number(((Date.now() - startedAt) / 60_000).toFixed(1)),
          left: leaveCount,
          killed: killCount,
          joined: replacements.seats.length,
          mintRefusals: replacements.refusals,
          duplicateSessionRows: duplicates,
        });
        if (duplicates.length) {
          rig.note('invariant.violated', { message: `duplicate participant sessions: ${JSON.stringify(duplicates)}` });
        }
        rig.note('soak.churn', {
          message: `cycle ${churnCycles} at ${churnLog.at(-1).atMinute}min — population now ${population.length}`,
        });
        nextChurnAt += churnEveryMinutes * 60_000;
      }

      const current = await rig.observe();
      const media = diffSamples(previous.viewers, current.viewers, {
        minIntervalMs: 1_000,
        expected: population.length,
      });
      const row = flattenRow(
        population.length,
        { after: current, media, joins: summariseJoins(current.viewers) },
        { elapsedMinutes: Number(((Date.now() - startedAt) / 60_000).toFixed(2)) },
      );
      timeline.push(row);
      previous = current;
      index += 1;
      if (index % 4 === 0 || index === 1) printTierRow(row);
    }

    const drift = degradationReport(timeline);
    const file = writeResult(`soak-${viewers}v-${minutes}m-${rig.runId}`, {
      runId: rig.runId,
      scenario: 'soak',
      viewers,
      minutes,
      churnEveryMinutes,
      churnCycles,
      churnLog,
      mintRefusals: refusals,
      timeline,
      drift,
      events: rig.events,
    });
    console.log(`\n${JSON.stringify(drift, null, 2)}\n\nchurn cycles: ${churnCycles}\n\nwritten: ${file}`);
    return { timeline, drift, churnLog };
  });
}

const SCENARIOS = { tiers, sustained, churn, 'restart-api': restartApi, 'restart-sfu': restartSfu, soak };

if (!scenario || !SCENARIOS[scenario]) {
  console.error(`usage: node run.mjs <${Object.keys(SCENARIOS).join('|')}> [--flags]`);
  process.exit(2);
}

SCENARIOS[scenario]().catch((err) => {
  console.error(`\n${scenario} failed: ${err.stack ?? err.message}`);
  process.exit(1);
});
