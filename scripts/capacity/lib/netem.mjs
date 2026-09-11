/**
 * Real network impairment on the media path, via `tc netem` inside the
 * SFU's own network namespace.
 *
 * # Why this shape, and what it is honestly worth
 *
 * The existing rig runs client and server on one machine over loopback,
 * where RTT is a few hundred microseconds and loss is zero. Numbers
 * measured there say nothing about a viewer on hotel wifi, and the
 * production report is explicit that this is a gap.
 *
 * Two things are needed to close it: latency and loss on the path, and
 * an honest label. This provides the first. `tc netem` is the Linux
 * kernel's own impairment qdisc — the same tool network engineers use —
 * and it is applied to the interface the SFU's media actually leaves by,
 * so every RTP packet, every RTCP report and every ICE keepalive is
 * subject to it. That is a genuinely impaired media path, not a
 * simulation at the application layer.
 *
 * The label: this is *emulated* impairment between two processes on one
 * machine. It is not a geographic test. A 120ms netem delay reproduces
 * the timing of a transatlantic path and reproduces none of its
 * middleboxes, MTU surprises, bufferbloat under cross-traffic, or
 * carrier-grade NAT. The report must say "emulated", and must not claim
 * a region it has not actually served a viewer in.
 *
 * # Why a sidecar container
 *
 * The SFU image runs as an unprivileged user and carries no iproute2, on
 * purpose — a production media node has no business holding NET_ADMIN.
 * A throwaway sidecar joined to the same network namespace
 * (`--network container:<id>`) can hold the capability instead, shape the
 * shared interface, and be discarded. The image under test is unchanged,
 * which is the point: impairing the node must not mean measuring a
 * different node.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Impairment profiles.
 *
 * Latencies are one-way, so a round trip sees twice the figure. The
 * names describe what each is meant to stand in for; the numbers are
 * what is actually applied and are what the report quotes.
 */
export const PROFILES = {
  clean: { description: 'no impairment — the loopback baseline', args: null },
  'same-region': {
    description: 'same-region client: 15ms ± 3ms one way, no loss',
    args: ['delay', '15ms', '3ms', 'distribution', 'normal'],
  },
  'cross-region': {
    description: 'cross-continent client: 90ms ± 15ms one way, 0.1% loss',
    args: ['delay', '90ms', '15ms', 'distribution', 'normal', 'loss', '0.1%'],
  },
  lossy: {
    description: 'lossy last mile: 30ms ± 10ms, 2% loss',
    args: ['delay', '30ms', '10ms', 'distribution', 'normal', 'loss', '2%'],
  },
  congested: {
    description: 'congested mobile: 150ms ± 50ms, 3% loss, 1% reordering',
    args: ['delay', '150ms', '50ms', 'distribution', 'normal', 'loss', '3%', 'reorder', '1%', '50%'],
  },
  blackhole: { description: 'total outage — every packet dropped', args: ['loss', '100%'] },
};

export class Netem {
  /** @param targetContainer name or id of the container whose namespace to shape */
  constructor(targetContainer, { iface = 'eth0', sidecarName = 'raven-capacity-netem' } = {}) {
    this.targetContainer = targetContainer;
    this.iface = iface;
    this.sidecarName = sidecarName;
    this.started = false;
    this.applied = 'clean';
  }

  async available() {
    try {
      await execFileAsync('docker', ['version', '--format', '{{.Server.Version}}']);
      return true;
    } catch {
      return false;
    }
  }

  async start() {
    await this.stop().catch(() => {});
    // Kept alive so each profile change is a fast `docker exec` rather
    // than a container start plus an apk install.
    await execFileAsync('docker', [
      'run',
      '-d',
      '--name',
      this.sidecarName,
      '--network',
      `container:${this.targetContainer}`,
      '--cap-add',
      'NET_ADMIN',
      'alpine:3.20',
      'sh',
      '-c',
      'apk add --no-cache iproute2 >/dev/null 2>&1 && sleep infinity',
    ]);

    // Wait for the apk install; tc does not exist until it finishes.
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      try {
        await execFileAsync('docker', ['exec', this.sidecarName, 'tc', '-V']);
        this.started = true;
        return this;
      } catch {
        await new Promise((r) => setTimeout(r, 1_000));
      }
    }
    throw new Error('netem sidecar never produced a working tc');
  }

  async tc(args) {
    return execFileAsync('docker', ['exec', this.sidecarName, 'tc', ...args]);
  }

  async clear() {
    await this.tc(['qdisc', 'del', 'dev', this.iface, 'root']).catch(() => {
      // No qdisc to delete is the normal case on the first call.
    });
    this.applied = 'clean';
  }

  async apply(profileName) {
    const profile = PROFILES[profileName];
    if (!profile) throw new Error(`unknown netem profile "${profileName}"`);
    await this.clear();
    if (profile.args) {
      await this.tc(['qdisc', 'add', 'dev', this.iface, 'root', 'netem', ...profile.args]);
    }
    this.applied = profileName;
    return profile;
  }

  /** What the kernel says is in force. Quoted in the report so the profile name is never taken on trust. */
  async describe() {
    try {
      const { stdout } = await this.tc(['qdisc', 'show', 'dev', this.iface]);
      return stdout.trim();
    } catch (err) {
      return `unavailable: ${err.message}`;
    }
  }

  async stop() {
    if (this.started) await this.clear().catch(() => {});
    await execFileAsync('docker', ['rm', '-f', this.sidecarName]).catch(() => {});
    this.started = false;
  }
}
