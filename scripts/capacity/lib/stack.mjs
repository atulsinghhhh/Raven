/**
 * Brings up the stack the capacity rig measures: a real API process, a
 * real Go SFU process, and a static server for the harness pages.
 *
 * # Why real child processes rather than an in-process Nest app
 *
 * The existing e2e suites boot Nest inside Jest, which is right for them
 * and wrong here for three reasons. Phase 6 restarts the API mid-stream,
 * and you cannot SIGTERM an object. CPU and RSS have to be attributable
 * to the API alone, which they are not when it shares a process with the
 * test runner and the Playwright driver. And Phase 9 runs two and three
 * of them at once. All three want a pid.
 */
import { execFile, spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.map': 'application/json',
  '.css': 'text/css',
};

/** Serves the harness directory. Bound to loopback; nothing here is meant to leave the machine. */
export function startHarnessServer(harnessDir) {
  const server = createServer((req, res) => {
    const requested = (req.url ?? '/').split('?')[0];
    const filePath = normalize(join(harnessDir, requested === '/' ? 'viewer.html' : requested));
    if (!filePath.startsWith(harnessDir) || !existsSync(filePath)) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    createReadStream(filePath).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

async function waitFor(label, probe, { timeoutMs = 60_000, intervalMs = 250, onGiveUp } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await probe()) return;
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  const extra = onGiveUp ? `\n${onGiveUp()}` : '';
  throw new Error(
    `timed out after ${timeoutMs}ms waiting for ${label}${lastError ? `: ${lastError.message}` : ''}${extra}`,
  );
}

/** A child process with its output kept, so a failure says what the process said. */
class LoggedProcess {
  constructor(label) {
    this.label = label;
    this.lines = [];
    this.child = undefined;
    this.exited = undefined;
  }

  spawn(command, args, options) {
    this.exited = undefined;
    this.child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    const capture = (chunk) => {
      for (const line of chunk.toString().split('\n')) {
        if (line.trim()) {
          this.lines.push(line);
          // Bounded: a two-hour soak at debug level would otherwise hold
          // the whole log in the runner's heap and skew its own memory.
          if (this.lines.length > 4_000) this.lines.splice(0, 1_000);
        }
      }
    };
    this.child.stdout?.on('data', capture);
    this.child.stderr?.on('data', capture);
    this.child.once('exit', (code, signal) => {
      this.exited = { code, signal };
    });
    return this.child;
  }

  get pid() {
    return this.child?.pid;
  }

  logs(tail = 60) {
    return this.lines.slice(-tail).join('\n');
  }

  async stop(signal = 'SIGTERM', graceMs = 8_000) {
    const child = this.child;
    if (!child || child.exitCode !== null || this.exited) return;
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, graceMs);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill(signal);
    });
  }
}

export class ApiProcess extends LoggedProcess {
  constructor({ repoRoot, port, env }) {
    super(`api:${port}`);
    this.repoRoot = repoRoot;
    this.port = port;
    this.env = env;
    this.baseUrl = `http://127.0.0.1:${port}`;
  }

  async start() {
    this.spawn(process.execPath, [join(this.repoRoot, 'apps', 'api', 'dist', 'main.js')], {
      cwd: join(this.repoRoot, 'apps', 'api'),
      env: { ...process.env, ...this.env, API_PORT: String(this.port) },
    });

    await waitFor(
      `API on ${this.baseUrl}`,
      async () => {
        if (this.exited) throw new Error(`API exited (code=${this.exited.code})`);
        // Any HTTP answer means the process is listening, and that is the
        // only thing being waited for. Reading the status would be wrong:
        // /health reports 503 whenever the RTC plane is absent, and the
        // SFU is deliberately started *after* the API — it needs the
        // control plane to register with. Requiring a 2xx here waits
        // forever for a condition this ordering guarantees is false.
        await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(3_000) });
        return true;
      },
      { timeoutMs: 90_000, onGiveUp: () => this.logs() },
    );
    return this;
  }

  /** Phase 6's restart: a real SIGTERM and a real cold boot, not a module reload. */
  async restart() {
    const startedAt = Date.now();
    await this.stop();
    await this.start();
    return Date.now() - startedAt;
  }
}

export class SfuProcess extends LoggedProcess {
  constructor({
    binary,
    nodeId,
    httpPort,
    udpMin,
    udpMax,
    controlPlaneUrl,
    registrationSecret,
    roomCapacity,
    region = 'local',
  }) {
    super(`sfu:${nodeId}`);
    Object.assign(this, {
      binary,
      nodeId,
      httpPort,
      udpMin,
      udpMax,
      controlPlaneUrl,
      registrationSecret,
      roomCapacity,
      region,
    });
    this.metricsUrl = `http://127.0.0.1:${httpPort}/metrics`;
    this.internalUrl = `http://127.0.0.1:${httpPort}`;
  }

  async start(isRegistered) {
    this.spawn(this.binary, [], {
      env: {
        ...process.env,
        SFU_NODE_ID: this.nodeId,
        SFU_REGION: this.region,
        SFU_HTTP_ADDR: `:${this.httpPort}`,
        SFU_INTERNAL_URL: this.internalUrl,
        SFU_PUBLIC_HOST: '127.0.0.1',
        SFU_PUBLIC_IP: '127.0.0.1',
        SFU_CONTROL_PLANE_URL: this.controlPlaneUrl,
        SFU_REGISTRATION_SECRET: this.registrationSecret,
        SFU_UDP_PORT_MIN: String(this.udpMin),
        SFU_UDP_PORT_MAX: String(this.udpMax),
        SFU_ROOM_CAPACITY: String(this.roomCapacity),
        SFU_HEARTBEAT_INTERVAL_SECONDS: '2',
        // info, not debug: at a hundred subscribers debug logging is
        // itself a measurable CPU cost, and it would land in the numbers
        // this rig exists to produce.
        SFU_LOG_LEVEL: 'info',
      },
    });

    await waitFor(
      `SFU ${this.nodeId} to register`,
      async () => {
        if (this.exited) throw new Error(`SFU exited (code=${this.exited.code})`);
        return isRegistered
          ? await isRegistered()
          : (await fetch(`${this.internalUrl}/healthz`, { signal: AbortSignal.timeout(2_000) })).ok;
      },
      { timeoutMs: 60_000, onGiveUp: () => this.logs() },
    );
    return this;
  }

  /** Phase 7's restart. SIGKILL, because a node that dies does not get to deregister first. */
  async hardRestart(isRegistered) {
    await this.stop('SIGKILL', 1_000);
    await new Promise((r) => setTimeout(r, 500));
    await this.start(isRegistered);
  }
}

/** Compiles the SFU once per run. Returns undefined when Go is absent, so the caller can say so plainly. */
export async function buildSfuBinary(repoRoot) {
  try {
    await execFileAsync('go', ['version']);
  } catch {
    return undefined;
  }
  const binary = join(mkdtempSync(join(tmpdir(), 'raven-capacity-sfu-')), 'raven-sfu');
  await execFileAsync('go', ['build', '-o', binary, './cmd/sfu'], {
    cwd: join(repoRoot, 'services', 'sfu'),
    timeout: 300_000,
  });
  return binary;
}

export async function buildApi(repoRoot) {
  await execFileAsync('pnpm', ['--filter', '@raven/api', 'build'], { cwd: repoRoot, timeout: 600_000 });
}

export { waitFor };

/**
 * The same SFU, in a container.
 *
 * Only Phase 10 needs this. Impairing the media path means `tc netem`,
 * `tc netem` means a Linux network namespace and NET_ADMIN, and on macOS
 * the only Linux namespace available is a container's. Every other
 * scenario runs the host binary, which is cheaper and gives a pid the
 * process sampler can read directly.
 *
 * The image is the production one, unmodified. What differs from a host
 * run is the namespace and the published-port hop; both are recorded in
 * the results, and the `clean` profile is measured through exactly the
 * same path so that every impaired number has an in-topology baseline to
 * be compared against rather than being compared to the host run.
 */
export class DockerSfuProcess {
  constructor({
    image = 'raven/sfu:dev',
    containerName,
    nodeId,
    httpPort,
    udpMin,
    udpMax,
    apiPort,
    registrationSecret,
    roomCapacity,
    region = 'local',
  }) {
    Object.assign(this, {
      image,
      containerName,
      nodeId,
      httpPort,
      udpMin,
      udpMax,
      apiPort,
      registrationSecret,
      roomCapacity,
      region,
    });
    this.metricsUrl = `http://127.0.0.1:${httpPort}/metrics`;
    this.internalUrl = `http://127.0.0.1:${httpPort}`;
    this.label = `sfu-docker:${nodeId}`;
  }

  static async imageExists(image = 'raven/sfu:dev') {
    try {
      await execFileAsync('docker', ['image', 'inspect', image]);
      return true;
    } catch {
      return false;
    }
  }

  static async build(repoRoot, image = 'raven/sfu:dev') {
    await execFileAsync(
      'docker',
      ['build', '-t', image, '-f', join(repoRoot, 'services', 'sfu', 'Dockerfile'), join(repoRoot, 'services', 'sfu')],
      {
        timeout: 900_000,
      },
    );
  }

  async start(isRegistered) {
    await this.stop();
    await execFileAsync('docker', [
      'run',
      '-d',
      '--name',
      this.containerName,
      '-p',
      `${this.httpPort}:7000`,
      // One-to-one, because ICE advertises the exact port it bound; a
      // remapped range hands clients addresses that do not exist.
      '-p',
      `${this.udpMin}-${this.udpMax}:${this.udpMin}-${this.udpMax}/udp`,
      '-e',
      `SFU_NODE_ID=${this.nodeId}`,
      '-e',
      `SFU_REGION=${this.region}`,
      '-e',
      'SFU_HTTP_ADDR=:7000',
      '-e',
      'SFU_PUBLIC_HOST=127.0.0.1',
      '-e',
      'SFU_PUBLIC_IP=127.0.0.1',
      // The API runs on the host, so the container reaches it by the
      // Docker Desktop alias rather than by localhost, which inside the
      // container is the container.
      '-e',
      `SFU_CONTROL_PLANE_URL=http://host.docker.internal:${this.apiPort}`,
      // What the API is told to probe. It runs on the host, so it must
      // be the published port, not the container's own address.
      '-e',
      `SFU_INTERNAL_URL=http://127.0.0.1:${this.httpPort}`,
      '-e',
      `SFU_REGISTRATION_SECRET=${this.registrationSecret}`,
      '-e',
      `SFU_UDP_PORT_MIN=${this.udpMin}`,
      '-e',
      `SFU_UDP_PORT_MAX=${this.udpMax}`,
      '-e',
      `SFU_ROOM_CAPACITY=${this.roomCapacity}`,
      '-e',
      'SFU_HEARTBEAT_INTERVAL_SECONDS=2',
      '-e',
      'SFU_LOG_LEVEL=info',
      '--add-host',
      'host.docker.internal:host-gateway',
      this.image,
    ]);

    await waitFor(
      `containerised SFU ${this.nodeId} to register`,
      async () =>
        isRegistered
          ? await isRegistered()
          : (await fetch(`${this.internalUrl}/healthz`, { signal: AbortSignal.timeout(2_000) })).ok,
      { timeoutMs: 90_000, onGiveUp: () => this.logs() },
    );
    return this;
  }

  get pid() {
    return undefined; // Read CPU and RSS from the node's own /metrics instead.
  }

  async logs(tail = 60) {
    try {
      const { stdout } = await execFileAsync('docker', ['logs', '--tail', String(tail), this.containerName]);
      return stdout;
    } catch (err) {
      return `docker logs failed: ${err.message}`;
    }
  }

  async stop() {
    await execFileAsync('docker', ['rm', '-f', this.containerName]).catch(() => {});
  }
}
