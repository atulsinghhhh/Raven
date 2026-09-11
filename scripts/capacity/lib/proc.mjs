/**
 * Per-process CPU and memory, sampled off the OS.
 *
 * # Why not `ps -o %cpu`
 *
 * On macOS (and on Linux for the same reason) `%cpu` is an average over
 * the process's entire lifetime, not an instantaneous rate. A process that
 * idled for ten minutes and is now pinning a core reports a few percent.
 * Every "CPU at N viewers" number in the report would be wrong, and wrong
 * in the flattering direction.
 *
 * So this differences cumulative CPU *time* between two samples over known
 * wall-clock, which is the same arithmetic `top` does and is a real rate.
 * 100% means one core fully busy; on a 10-core machine the ceiling is
 * 1000%.
 */
import { execFile } from 'node:child_process';
import { cpus, loadavg, totalmem, freemem } from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
export const CORE_COUNT = cpus().length;

/** "12:34.56" / "1-02:03:04" / "03:04" -> seconds. */
function parseCpuTime(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const [daysPart, rest] = trimmed.includes('-') ? trimmed.split('-') : [null, trimmed];
  const pieces = rest.split(':').map(Number);
  if (pieces.some(Number.isNaN)) return null;
  let seconds = 0;
  for (const piece of pieces) seconds = seconds * 60 + piece;
  if (daysPart) seconds += Number(daysPart) * 86_400;
  return seconds;
}

/** One raw sample for a set of pids: cumulative CPU seconds and current RSS. */
export async function sampleProcesses(pids) {
  const live = pids.filter((pid) => Number.isInteger(pid) && pid > 0);
  if (live.length === 0) return { at: Date.now(), byPid: new Map() };
  let stdout = '';
  try {
    ({ stdout } = await execFileAsync('ps', ['-o', 'pid=,time=,rss=', '-p', live.join(',')]));
  } catch {
    // ps exits non-zero when every pid it was given has gone. An empty
    // sample is the honest answer; the caller notices the gap.
    return { at: Date.now(), byPid: new Map() };
  }
  const byPid = new Map();
  for (const line of stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(\S+)\s+(\d+)\s*$/.exec(line);
    if (!match) continue;
    byPid.set(Number(match[1]), { cpuSeconds: parseCpuTime(match[2]), rssKb: Number(match[3]) });
  }
  return { at: Date.now(), byPid };
}

/** Every descendant of a pid, inclusive. Chromium is a process tree, not a process. */
export async function descendantPids(rootPid) {
  let stdout = '';
  try {
    ({ stdout } = await execFileAsync('ps', ['-Aww', '-o', 'pid=,ppid=']));
  } catch {
    return [rootPid];
  }
  const children = new Map();
  for (const line of stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    const bucket = children.get(ppid) ?? [];
    bucket.push(pid);
    children.set(ppid, bucket);
  }
  const out = [];
  const queue = [rootPid];
  while (queue.length) {
    const pid = queue.shift();
    out.push(pid);
    for (const child of children.get(pid) ?? []) queue.push(child);
  }
  return out;
}

/**
 * Tracks one named process tree across samples and reports a true CPU rate.
 *
 * Re-resolves the tree on every sample rather than caching it: Chromium
 * spawns and reaps renderer processes as pages open and close, and a
 * cached list would quietly stop counting the ones that matter.
 */
export class ProcessTreeSampler {
  constructor(name, rootPid) {
    this.name = name;
    this.rootPid = rootPid;
    this.previous = null;
  }

  async sample() {
    const pids = await descendantPids(this.rootPid);
    const current = await sampleProcesses(pids);

    let rssMb = 0;
    let cpuSecondsTotal = 0;
    for (const stats of current.byPid.values()) {
      rssMb += (stats.rssKb ?? 0) / 1024;
      cpuSecondsTotal += stats.cpuSeconds ?? 0;
    }

    let cpuPercent = null;
    if (this.previous) {
      // Only pids present in both samples contribute, so a renderer that
      // started mid-interval does not appear as a spike of CPU it never
      // used, and one that exited does not appear as negative time.
      let delta = 0;
      for (const [pid, stats] of current.byPid) {
        const before = this.previous.byPid.get(pid);
        if (!before) continue;
        const d = (stats.cpuSeconds ?? 0) - (before.cpuSeconds ?? 0);
        if (d > 0) delta += d;
      }
      const wallSeconds = (current.at - this.previous.at) / 1000;
      if (wallSeconds > 0) cpuPercent = (delta / wallSeconds) * 100;
    }

    this.previous = current;
    return { name: this.name, processCount: current.byPid.size, rssMb, cpuSecondsTotal, cpuPercent };
  }
}

export function systemSnapshot() {
  const [load1, load5, load15] = loadavg();
  return {
    cores: CORE_COUNT,
    load1,
    load5,
    load15,
    // A load average at or above the core count means the machine is
    // saturated. That matters here because a saturated *rig* and a
    // saturated *SFU* produce the same viewer-side symptoms, and the
    // report has to be able to tell them apart.
    saturated: load1 >= CORE_COUNT,
    memTotalMb: totalmem() / 1e6,
    memFreeMb: freemem() / 1e6,
  };
}

/**
 * The rig's own browser processes, found by executable path.
 *
 * Playwright's `Browser` object exposes no pid in this version — the
 * launched process is owned by the driver, not by the Node handle — so
 * the tree has to be found from the outside. Matching on the resolved
 * Chromium executable path is exact: it is a per-Playwright-install path
 * under ms-playwright, so it cannot collide with the user's own browser.
 *
 * This matters more than it sounds. Attributing CPU to the rig is what
 * lets the report distinguish "the SFU is at its limit" from "the
 * laptop generating the load is at its limit", and those two findings
 * lead to opposite decisions.
 */
export class BrowserTreeSampler {
  constructor(executablePath) {
    this.name = 'browser';
    // Match the Playwright browser cache root, not the executable.
    //
    // Two things defeat the narrower match. Chromium's renderers and GPU
    // process are separate processes, and they are where essentially all
    // of the decoding CPU is — matching only the parent finds one
    // process and misses the work. And `chromium.executablePath()`
    // returns the full Chrome-for-Testing bundle while a headless launch
    // actually runs `chrome-headless-shell`, a different binary in a
    // sibling directory, so the parent is not matched either. Both
    // failures read as exactly 0%, which looks like a result rather than
    // a bug — and the whole point of this sampler is deciding whether
    // the rig or the SFU is the limit.
    //
    // The cache root cannot collide with the user's own browser: nothing
    // outside Playwright installs under ms-playwright.
    const marker = '/ms-playwright/';
    const index = executablePath.indexOf(marker);
    this.needle = index >= 0 ? executablePath.slice(0, index + marker.length) : executablePath;
    this.previous = null;
  }

  async pids() {
    try {
      // -ww, without which macOS truncates the command column to the
      // terminal width and the Playwright path — which is long and lives
      // under a deep cache directory — never appears in full. The
      // silent symptom is a browser CPU reading of exactly 0%, which is
      // worse than an error because it looks like a result.
      const { stdout } = await execFileAsync('ps', ['-Aww', '-o', 'pid=,command=']);
      const needle = this.needle;
      return (
        stdout
          .split('\n')
          // startsWith on the command, so the runner's own `node -e` and
          // shell lines — which mention the path in their arguments — are
          // not counted as browser processes.
          .filter((line) => line.replace(/^\s*\d+\s+/, '').startsWith(needle))
          .map((line) => Number(/^\s*(\d+)/.exec(line)?.[1]))
          .filter((pid) => Number.isInteger(pid) && pid > 0)
      );
    } catch {
      return [];
    }
  }

  async sample() {
    const current = await sampleProcesses(await this.pids());
    let rssMb = 0;
    let cpuSecondsTotal = 0;
    for (const stats of current.byPid.values()) {
      rssMb += (stats.rssKb ?? 0) / 1024;
      cpuSecondsTotal += stats.cpuSeconds ?? 0;
    }
    let cpuPercent = null;
    if (this.previous) {
      let delta = 0;
      for (const [pid, stats] of current.byPid) {
        const before = this.previous.byPid.get(pid);
        if (!before) continue;
        const d = (stats.cpuSeconds ?? 0) - (before.cpuSeconds ?? 0);
        if (d > 0) delta += d;
      }
      const wallSeconds = (current.at - this.previous.at) / 1000;
      if (wallSeconds > 0) cpuPercent = (delta / wallSeconds) * 100;
    }
    this.previous = current;
    return { name: this.name, processCount: current.byPid.size, rssMb, cpuSecondsTotal, cpuPercent };
  }
}
