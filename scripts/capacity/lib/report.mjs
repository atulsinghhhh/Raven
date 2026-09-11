/** Writes results where a reader can check them, and prints the same thing to the terminal. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RESULTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'results');

export function writeResult(name, payload) {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const file = join(RESULTS_DIR, `${name}.json`);
  writeFileSync(file, JSON.stringify(payload, null, 2));
  return file;
}

const n = (value, digits = 1) => (value == null || Number.isNaN(value) ? '—' : Number(value).toFixed(digits));

export function tierTable(rows) {
  const header = [
    'Viewers',
    'Join ok',
    'Media ok',
    'p95 join',
    'SFU CPU%',
    'SFU RSS',
    'Out Mbps',
    'In Mbps',
    'Loss%',
    'fps',
    'Goroutines',
    'Load',
  ];
  const lines = [`| ${header.join(' | ')} |`, `|${header.map(() => '---').join('|')}|`];
  for (const r of rows) {
    lines.push(
      `| ${r.viewers} | ${r.joinedCount}/${r.viewers} | ${r.mediaAliveCount}/${r.viewers} | ${n(r.joinP95Ms, 0)}ms | ` +
        `${n(r.sfuCpuPercent)} | ${n(r.sfuRssMb)}MB | ${n(r.outboundMbps, 2)} | ${n(r.inboundMbps, 2)} | ` +
        `${n(r.lossPercentMean, 2)} | ${n(r.decodedFpsMean)} | ${r.goroutines ?? '—'} | ${n(r.load1)} |`,
    );
  }
  return lines.join('\n');
}

export function printTierRow(r) {
  console.log(
    `\n  ${r.viewers} viewers: joined ${r.joinedCount}/${r.viewers}, media alive ${r.mediaAliveCount}/${r.viewers} ` +
      `(${n(r.mediaAlivePercent)}%)\n` +
      `    join p50/p95 ${n(r.joinP50Ms, 0)}/${n(r.joinP95Ms, 0)}ms, first media p95 ${n(r.firstMediaP95Ms, 0)}ms\n` +
      `    SFU: cpu ${n(r.sfuCpuPercent)}% rss ${n(r.sfuRssMb)}MB goroutines ${r.goroutines ?? '—'} participants ${r.sfuParticipants ?? '—'}\n` +
      `    throughput: in ${n(r.inboundMbps, 2)} Mbps / out ${n(r.outboundMbps, 2)} Mbps (viewer-side total ${n(r.viewerInboundMbpsTotal, 2)} Mbps)\n` +
      `    quality: fps ${n(r.decodedFpsMean)} (p05 ${n(r.decodedFpsP05)}), loss ${n(r.lossPercentMean, 2)}%, jitter ${n(r.jitterMsMean, 1)}ms, rtt ${n(r.rttMsMean, 1)}ms, freezes ${r.freezes ?? 0}\n` +
      `    rig: browser cpu ${n(r.browserCpuPercent)}% rss ${n(r.browserRssMb, 0)}MB, api cpu ${n(r.apiCpuPercent)}%, load1 ${n(r.load1)}/${r.cores} ${r.saturated ? '⚠ SATURATED' : ''}`,
  );
  if (r.elementFramesStalledCount) {
    console.log(
      `    note: ${r.elementFramesStalledCount} media-alive viewer(s) had a stalled <video> element counter despite ` +
        `advancing decode stats — see analyse.mjs's module doc. Not counted as a media failure.`,
    );
  }
  if (r.failureReasons && Object.keys(r.failureReasons).length) {
    console.log(`    failures: ${JSON.stringify(r.failureReasons)}`);
    for (const failure of (r.failures ?? []).slice(0, 5)) {
      console.log(
        `      ${failure.id}: ${failure.reason} state=${failure.connectionState ?? '—'} ${failure.error ? JSON.stringify(failure.error) : ''}`,
      );
    }
  }
  if (r.mintRefusals?.length) {
    console.log(`    mint refusals: ${r.mintRefusals.length} — ${JSON.stringify(r.mintRefusals.slice(0, 3))}`);
  }
}

export { RESULTS_DIR };
