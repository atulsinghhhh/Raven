#!/usr/bin/env node
/**
 * Phase 10: what a viewer sees when the network is not loopback.
 *
 * The rest of the rig runs client and SFU on one machine, where RTT is
 * a few hundred microseconds and loss is zero. That is the right
 * environment for a capacity ceiling — it removes the network as a
 * confounder — and it is the wrong environment for every quality
 * question, which is exactly what the production report says is
 * missing.
 *
 * This runs the same audience against the same SFU with `tc netem`
 * applied to the node's interface, so latency, jitter, loss and
 * reordering are imposed by the kernel on real RTP. See lib/netem.mjs
 * for why that means a containerised node, and for the limits of what
 * emulation can claim.
 *
 * The `clean` profile is measured through the identical container-and-
 * published-port topology, so every impaired figure has a baseline from
 * the same path rather than being compared against the host-process
 * runs. Without that, the container hop would be silently folded into
 * the "latency" result.
 *
 *   node network.mjs --viewers 10 --profiles clean,same-region,cross-region,lossy,congested
 *   node network.mjs --outage 20        # blackhole for 20s, then measure recovery
 */
import { diffSamples, summariseJoins } from './lib/analyse.mjs';
import { Netem, PROFILES } from './lib/netem.mjs';
import { writeResult } from './lib/report.mjs';
import { Rig, sleep } from './lib/rig.mjs';

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
const VIEWERS = Number(args.viewers ?? 10);
const PROFILE_NAMES = (args.profiles ?? 'clean,same-region,cross-region,lossy,congested').split(',');
const OUTAGE_SECONDS = Number(args.outage ?? 20);

function quality(media, netemProfile, netemActual, joins) {
  return {
    profile: netemProfile,
    tcQdisc: netemActual,
    ...joins,
    mediaAliveCount: media.mediaAliveCount,
    mediaAlivePercent: media.mediaAlivePercent,
    decodedFpsMean: media.decodedFpsMean,
    decodedFpsP05: media.decodedFpsP05,
    lossPercentMean: media.lossPercentMean,
    lossPercentP95: media.lossPercentP95,
    jitterMsMean: media.jitterMsMean,
    jitterMsP95: media.jitterMsP95,
    rttMsMean: media.rttMsMean,
    rttMsP95: media.rttMsP95,
    freezes: media.freezes,
    reconnects: media.reconnects,
    viewerInboundKbpsMean: media.viewerInboundKbpsMean,
    failureReasons: media.failureReasons,
  };
}

async function main() {
  const rig = new Rig({
    sfuMode: 'docker',
    // Docker publishes UDP ports individually; a 600-wide range costs
    // minutes to bind. Phase 10 needs enough for a small audience only.
    sfuUdpMin: 53_700,
    sfuUdpMax: 53_780,
    sfuRoomCapacity: 60,
    profile: args.profile ?? '360p',
    perPage: Number(args['per-page'] ?? 10),
    skipSdkBuild: args['skip-sdk-build'] === 'true',
    skipApiBuild: args['skip-api-build'] === 'true',
  });

  const netem = new Netem(`raven-capacity-sfu-${rig.runId}`);
  if (!(await netem.available())) {
    console.error('Docker is not available, so no network namespace can be shaped. Phase 10 cannot run here.');
    process.exit(1);
  }

  const rows = [];
  let outage = null;

  try {
    await rig.up();
    await netem.start();
    rig.note('netem.ready', { message: await netem.describe() });

    await rig.openStream({ title: `Network conditions ${rig.runId}` });
    const { seats, refusals } = await rig.mintSeats(VIEWERS);
    if (refusals.length) rig.note('mint.refused', { message: `${refusals.length}` });

    for (const profileName of PROFILE_NAMES) {
      const profile = await netem.apply(profileName);
      const actual = await netem.describe();
      rig.note('netem.applied', { message: `${profileName} — ${actual}` });

      // A fresh audience per profile, because time-to-first-media under
      // impairment is one of the numbers being asked for, and it can
      // only be measured on a join that happened while the impairment
      // was in force.
      if (rig.audience) {
        await rig.audience.close();
        rig.audience = undefined;
      }
      const joinStartedAt = Date.now();
      await rig.seatAudience(seats.map((s) => ({ ...s })));
      const joinWallMs = Date.now() - joinStartedAt;

      await sleep(15_000);
      const before = await rig.observe();
      await sleep(10_000);
      const after = await rig.observe();
      const media = diffSamples(before.viewers, after.viewers, { minIntervalMs: 2_000 });
      const row = {
        ...quality(media, profileName, actual, summariseJoins(after.viewers)),
        description: profile.description,
        joinWallMs,
        sfuOutboundMbps: after.sfu.rates?.outboundMbps ?? null,
        sfuCpuPercent: after.sfu.rates?.cpuPercent ?? null,
      };
      rows.push(row);
      console.log(
        `\n  ${profileName} (${profile.description})\n` +
          `    media alive ${row.mediaAliveCount}/${VIEWERS}, first media p95 ${row.firstMediaP95Ms?.toFixed(0) ?? '—'}ms\n` +
          `    fps ${row.decodedFpsMean?.toFixed(1) ?? '—'} (p05 ${row.decodedFpsP05?.toFixed(1) ?? '—'}), ` +
          `loss ${row.lossPercentMean?.toFixed(2) ?? '—'}%, jitter ${row.jitterMsMean?.toFixed(1) ?? '—'}ms, rtt ${row.rttMsMean?.toFixed(1) ?? '—'}ms, freezes ${row.freezes}`,
      );
    }

    // Disconnect and reconnect, for real: every packet dropped for
    // OUTAGE_SECONDS, then the impairment lifted. This is the case the
    // SDK's auto-reconnect exists for, and the number that matters is
    // how long after the network returns media does.
    if (OUTAGE_SECONDS > 0) {
      await netem.apply('same-region');
      if (rig.audience) {
        await rig.audience.close();
        rig.audience = undefined;
      }
      await rig.seatAudience(seats.map((s) => ({ ...s })));
      await sleep(15_000);

      const healthy = await rig.observe();
      await netem.apply('blackhole');
      // Confirmed, not assumed: log exactly what the kernel reports is
      // in force, the same way the profile loop above does. Without this
      // a silently-failed apply() and a genuinely impaired path are
      // indistinguishable from the result alone — and the difference
      // matters, because the former would make every number below a
      // false claim of resilience.
      const blackholeQdisc = await netem.describe();
      rig.note('outage.start', { message: `${OUTAGE_SECONDS}s blackhole — ${blackholeQdisc}` });

      // Sampled at the midpoint too, not only at the end. A real outage
      // and a stats call that raced the qdisc's own application would
      // both show "fine at both ends"; only a midpoint sample can catch
      // media that kept flowing for the first few seconds and then
      // genuinely stopped, or vice versa.
      await sleep((OUTAGE_SECONDS * 1000) / 2);
      const midpoint = await rig.observe();
      await sleep((OUTAGE_SECONDS * 1000) / 2);

      const during = await rig.observe();
      // Diagnostic: the actual counters for one viewer, not just the
      // derived alive/dead verdict — printed only when RAW_DEBUG is set,
      // so a normal run stays quiet.
      if (process.env.RAW_DEBUG === '1') {
        const pick = (s) => s.viewers.find((v) => v.id === 'viewer-0');
        console.log('\n  --- raw diagnostic: viewer-0 ---');
        console.log('  healthy:', JSON.stringify(pick(healthy)?.raw));
        console.log('  midpoint:', JSON.stringify(pick(midpoint)?.raw));
        console.log('  during:', JSON.stringify(pick(during)?.raw));
        console.log('  during connectionState:', pick(during)?.connectionState, pick(during)?.sdkConnectionState);
      }
      // Diffed against the midpoint, not against `healthy`. A raw
      // dump caught this the hard way: `healthy → during` shows a
      // handful of frames' worth of positive delta even on a
      // connection that failed outright, because packets already
      // in flight when the qdisc took effect still land in the
      // first second or two — long before the 20s window ends.
      // `healthy → during` therefore reports "still alive" off a
      // few leftover packets while `connectionState` has already
      // gone to `failed` and every counter has been frozen for the
      // second half of the outage. `midpoint → during` — the second
      // half only — is what actually answers "is anything moving
      // *right now*, sustained," which is the claim "N/N survived a
      // 20s outage" is supposed to be making.
      const duringMedia = diffSamples(midpoint.viewers, during.viewers, { minIntervalMs: 2_000 });
      const midpointMedia = diffSamples(healthy.viewers, midpoint.viewers, { minIntervalMs: 2_000 });
      rig.note('outage.midpoint', {
        message: `${midpointMedia.mediaAliveCount}/${VIEWERS} still reporting decode at the halfway point (may include in-flight packets draining after the outage began)`,
      });

      await netem.apply('same-region');
      const restoredAt = Date.now();
      rig.note('outage.end', {});

      let recoveredAtMs = null;
      let previous = await rig.observe();
      const deadline = Date.now() + 180_000;
      const trace = [];
      while (Date.now() < deadline) {
        await sleep(5_000);
        const current = await rig.observe();
        const m = diffSamples(previous.viewers, current.viewers, { minIntervalMs: 2_000 });
        trace.push({
          sinceRestoreMs: Date.now() - restoredAt,
          mediaAliveCount: m.mediaAliveCount,
          reconnects: m.reconnects,
        });
        if (m.mediaAliveCount >= Math.ceil(VIEWERS * 0.9)) {
          recoveredAtMs = Date.now() - restoredAt;
          break;
        }
        previous = current;
      }

      outage = {
        outageSeconds: OUTAGE_SECONDS,
        blackholeQdisc,
        mediaAliveAtMidpoint: midpointMedia.mediaAliveCount,
        mediaAliveDuringOutage: duringMedia.mediaAliveCount,
        recoveredAtMs,
        recoveredViewers: trace[trace.length - 1]?.mediaAliveCount ?? 0,
        totalViewers: VIEWERS,
        trace,
      };
      console.log(
        `\n  outage qdisc: ${blackholeQdisc}\n` +
          `  outage: ${midpointMedia.mediaAliveCount}/${VIEWERS} still decoding at 10s, ${duringMedia.mediaAliveCount}/${VIEWERS} at 20s; recovery ${recoveredAtMs ?? 'not reached'}ms`,
      );
    }
  } finally {
    await netem.stop().catch(() => {});
    await rig.down().catch((err) => console.error(`teardown: ${err.message}`));
  }

  const file = writeResult(`network-${VIEWERS}v-${rig.runId}`, {
    runId: rig.runId,
    scenario: 'network',
    viewers: VIEWERS,
    topology: 'containerised SFU, published UDP ports, tc netem on the node interface — emulated, not geographic',
    profiles: Object.fromEntries(PROFILE_NAMES.map((p) => [p, PROFILES[p]?.description ?? 'unknown'])),
    rows,
    outage,
    events: rig.events,
  });
  console.log(`\nwritten: ${file}`);
}

main().catch((err) => {
  console.error(err.stack ?? err.message);
  process.exit(1);
});
