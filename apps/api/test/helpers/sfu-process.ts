import { execFile, spawn, ChildProcess } from 'child_process';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Builds and runs a real Raven SFU as a child process, for e2e tests that
 * need the media plane to actually exist.
 *
 * # Why a real node rather than a fake one
 *
 * `room.join` allocates an RTC server and asks it for a PeerConnection.
 * Without a registered node it fails with `NO_RTC_CAPACITY` — correctly,
 * and that path is worth testing, but it is not the path a call takes. A
 * stubbed node link would let the API's own frames be checked and nothing
 * else: not that Pion accepts them, not that the SDP coming back is a
 * real session description, not that registration and heartbeating work
 * against the real controller. Those are exactly the seams a unit test
 * cannot see, which is what makes them worth an e2e.
 *
 * # Ordering
 *
 * The node registers itself with the control plane on boot, so the API
 * must be listening first — and because the e2e app binds port 0, its
 * address is not known until then. That rules out running the SFU from
 * docker-compose alongside Postgres and Redis: it has to be spawned by
 * the test, pointed at the port the app actually got.
 */
export interface SfuProcessOptions {
  /** Base URL of the already-listening API under test. */
  controlPlaneUrl: string;
  /** Must match the API's `SFU_REGISTRATION_SECRET`. */
  registrationSecret: string;
  /** Unique per run, so a leftover row from a crashed run is reclaimed rather than duplicated. */
  nodeId: string;
  region?: string;
  /** The node's own HTTP port: node link, health, metrics. */
  httpPort: number;
  udpPortMin: number;
  udpPortMax: number;
}

/** Compiles the SFU, or returns undefined when Go is not installed. */
export async function buildSfuBinary(): Promise<string | undefined> {
  try {
    await execFileAsync('go', ['version']);
  } catch {
    return undefined;
  }

  const binary = join(mkdtempSync(join(tmpdir(), 'raven-sfu-e2e-')), 'raven-sfu');
  // The repo root is four levels up from apps/api/test/helpers.
  const sfuDir = join(__dirname, '..', '..', '..', '..', 'services', 'sfu');

  // A cold module cache makes this the slowest step in the suite by a wide
  // margin, so the default 10-second timeout is nowhere near enough.
  await execFileAsync('go', ['build', '-o', binary, './cmd/sfu'], {
    cwd: sfuDir,
    timeout: 240_000,
  });

  return binary;
}

export class SfuProcess {
  private child?: ChildProcess;
  private readonly logLines: string[] = [];
  private exited?: { code: number | null; signal: string | null };

  constructor(
    private readonly binary: string,
    private readonly options: SfuProcessOptions,
  ) {}

  /**
   * Starts the node and resolves once the control plane has it registered.
   *
   * `isRegistered` is supplied by the caller rather than polled here
   * because only the test knows how to ask the API under test — and
   * asking the API is the point: a node that thinks it registered but
   * does not appear in the registry is the failure this waits out.
   */
  async start(isRegistered: () => Promise<boolean>): Promise<void> {
    const { options } = this;

    this.child = spawn(this.binary, [], {
      env: {
        ...process.env,
        SFU_NODE_ID: options.nodeId,
        SFU_REGION: options.region ?? 'local',
        SFU_HTTP_ADDR: `:${options.httpPort}`,
        // Explicit, because the derived default uses $HOSTNAME — which on
        // a developer's machine is a name the API cannot resolve.
        SFU_INTERNAL_URL: `http://127.0.0.1:${options.httpPort}`,
        SFU_PUBLIC_HOST: '127.0.0.1',
        SFU_PUBLIC_IP: '127.0.0.1',
        SFU_CONTROL_PLANE_URL: options.controlPlaneUrl,
        SFU_REGISTRATION_SECRET: options.registrationSecret,
        SFU_UDP_PORT_MIN: String(options.udpPortMin),
        SFU_UDP_PORT_MAX: String(options.udpPortMax),
        // Capacity may not exceed the UDP port span — the node's own
        // config validation refuses to boot otherwise.
        SFU_ROOM_CAPACITY: String(Math.min(20, options.udpPortMax - options.udpPortMin + 1)),
        SFU_HEARTBEAT_INTERVAL_SECONDS: '2',
        SFU_LOG_LEVEL: 'debug',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const capture = (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        if (line.trim()) this.logLines.push(line);
      }
    };
    this.child.stdout?.on('data', capture);
    this.child.stderr?.on('data', capture);
    this.child.once('exit', (code, signal) => {
      this.exited = { code, signal };
    });

    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (this.exited) {
        throw new Error(
          `SFU exited before registering (code=${this.exited.code} signal=${this.exited.signal}).\n${this.logs()}`,
        );
      }
      if (await isRegistered()) {
        return;
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    throw new Error(`SFU did not register within 30s.\n${this.logs()}`);
  }

  /** The node's own logs, so a failure message says what actually happened. */
  logs(): string {
    return this.logLines.length
      ? `--- sfu output ---\n${this.logLines.join('\n')}`
      : '(no sfu output)';
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child || child.exitCode !== null) {
      return;
    }
    // SIGTERM rather than SIGKILL: the node closes its rooms and
    // deregisters on the way out, and exercising that shutdown path is
    // better than skipping it.
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 5_000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill('SIGTERM');
    });
    this.child = undefined;
  }
}

/**
 * Ports for the e2e node.
 *
 * Deliberately not 51000-51200: `docker compose` publishes exactly that
 * range for the local SFU, and two processes contending for a UDP port
 * surfaces as an unexplained ICE failure rather than a clear bind error.
 */
export const E2E_SFU_HTTP_PORT = 17_431;
export const E2E_SFU_UDP_MIN = 52_400;
export const E2E_SFU_UDP_MAX = 52_440;
