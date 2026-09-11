/**
 * The rig: stack up, stream created, audience seated, samples taken.
 *
 * Every scenario in run.mjs is this object plus a different script on top
 * of it, so that "50 viewers for a minute" and "50 viewers for two hours
 * with churn and a restart" are measured by identical code and their
 * numbers are comparable.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Audience, Host, chromiumExecutablePath, launchBrowser } from './audience.mjs';
import { ensureContent } from './content.mjs';
import { Db } from './db.mjs';
import { ControlPlane } from './mint.mjs';
import { BrowserTreeSampler, ProcessTreeSampler, systemSnapshot } from './proc.mjs';
import { SignalingRedis } from './redis.mjs';
import { deriveRates, scrapeSfu } from './sfu-metrics.mjs';
import { ApiProcess, DockerSfuProcess, SfuProcess, buildApi, buildSfuBinary, startHarnessServer } from './stack.mjs';
import { stageHarnessSdk } from '../build-harness-sdk.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, '..', '..', '..');
const HARNESS_DIR = join(HERE, '..', 'harness');

export const DEFAULTS = {
  apiPort: 4711,
  sfuHttpPort: 17_500,
  // 601 ports for up to ~200 PeerConnections. The node refuses to boot if
  // the span is narrower than its room capacity, and ICE gathering takes
  // more than one port per connection, so this is sized well above the
  // largest tier rather than exactly at it. A range too tight surfaces as
  // unexplained connection failures under load, which is the single worst
  // thing for a capacity measurement to be confounded by.
  sfuUdpMin: 53_000,
  sfuUdpMax: 53_600,
  sfuRoomCapacity: 200,
  perPage: 10,
  staggerMs: 120,
  profile: '360p',
};

export class Rig {
  constructor(options = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.runId = options.runId ?? `${Date.now().toString(36)}`;
    this.events = [];
    this.pageLogSink = [];
  }

  note(kind, detail) {
    const event = { at: new Date().toISOString(), kind, ...detail };
    this.events.push(event);
    console.log(`  · ${kind}${detail?.message ? ` — ${detail.message}` : ''}`);
    return event;
  }

  async up() {
    const { options } = this;

    // The machine's state before the rig touches it.
    //
    // This is not decoration. A run whose viewer-side frame rate falls
    // while SFU CPU stays flat is either "the SFU is fine and the rig
    // ran out of machine" or "something unrelated was compiling in
    // another window" — and without a baseline those are
    // indistinguishable after the fact. One ramp during this work was
    // invalidated exactly that way: the 10-viewer tier measured 3.9 Mbps
    // outbound at load 9.7, against 17.3 Mbps at load 2.7 half an hour
    // earlier, because lint and typecheck were running alongside it.
    this.baselineSystem = systemSnapshot();
    this.note('baseline', {
      message: `load1 ${this.baselineSystem.load1.toFixed(2)} on ${this.baselineSystem.cores} cores, ${Math.round(this.baselineSystem.memFreeMb)}MB free`,
    });
    const busyThreshold = Number(options.maxBaselineLoad ?? this.baselineSystem.cores * 0.4);
    if (this.baselineSystem.load1 > busyThreshold && !options.allowBusy) {
      throw new Error(
        `Refusing to measure on a busy machine: load1 is ${this.baselineSystem.load1.toFixed(2)} and the threshold is ` +
          `${busyThreshold.toFixed(2)} (${this.baselineSystem.cores} cores).\n` +
          'Every viewer here is a real decoder on this machine, so competing work does not just add noise — it changes ' +
          'the answer, and in the direction that under-reports capacity.\n' +
          'Close what else is running, or pass --allow-busy to record the number anyway with the baseline attached.',
      );
    }

    const dbUrl = process.env.CAPACITY_DATABASE_URL;
    if (!dbUrl) {
      throw new Error(
        'CAPACITY_DATABASE_URL is not set.\n' +
          'This rig writes users, projects, streams and registry rows and does not clean all of them up,\n' +
          'so it refuses to guess at a database. Point it at a scratch Postgres:\n\n' +
          '  docker run --rm -d --name raven-capacity-db -p 55432:5432 \\\n' +
          '    -e POSTGRES_PASSWORD=test -e POSTGRES_DB=postgres postgres:16-alpine\n' +
          '  DATABASE_URL=... DIRECT_URL=... pnpm --filter @raven/api prisma:migrate:deploy\n' +
          '  CAPACITY_DATABASE_URL=postgresql://postgres:test@localhost:55432/postgres\n',
      );
    }
    const { hostname } = new URL(dbUrl);
    if (
      !['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(hostname) &&
      process.env.ALLOW_CAPACITY_AGAINST_REMOTE_DB !== '1'
    ) {
      throw new Error(
        `Refusing to run the capacity rig against "${hostname}" — see apps/api/test/guard-database-target.ts for why.`,
      );
    }

    const redisUrl = process.env.CAPACITY_REDIS_URL ?? process.env.REDIS_URL;
    if (!redisUrl) throw new Error('CAPACITY_REDIS_URL (or REDIS_URL) is not set.');

    this.registrationSecret = process.env.SFU_REGISTRATION_SECRET ?? 'capacity-rig-registration-secret';

    if (!options.skipSdkBuild) {
      this.note('sdk.build', { message: 'building @ravenkash/rtc, chat, client from source' });
      stageHarnessSdk({ rebuild: true });
    } else if (!existsSync(join(HARNESS_DIR, 'vendor', 'raven-client.js'))) {
      stageHarnessSdk({ rebuild: false });
    }

    if (!options.skipApiBuild) {
      this.note('api.build', { message: 'nest build' });
      await buildApi(REPO);
    }

    if (options.sfuMode === 'docker') {
      if (!(await DockerSfuProcess.imageExists())) {
        this.note('sfu.image', { message: 'building raven/sfu:dev' });
        await DockerSfuProcess.build(REPO);
      }
    } else {
      this.note('sfu.build', { message: 'go build ./cmd/sfu' });
      this.sfuBinary = await buildSfuBinary(REPO);
      if (!this.sfuBinary) {
        throw new Error('Go is not installed, so no SFU can be built. Every media number here needs a real node.');
      }
    }

    this.db = new Db(dbUrl);
    this.redis = await new SignalingRedis(redisUrl).connect();

    this.nodeId = `sfu-capacity-${this.runId}`;
    // Deterministic allocation: leftover rows from earlier runs and from
    // the compose node point at ports nothing is listening on any more,
    // and the allocator will happily hand a room to one of them.
    const removed = await this.db.clearForeignSfuRows(this.nodeId);
    if (removed.length)
      this.note('registry.cleared', {
        message: `${removed.length} stale rtc_servers row(s): ${removed.map((r) => r.name).join(', ')}`,
      });

    const harness = await startHarnessServer(HARNESS_DIR);
    this.harnessServer = harness.server;
    this.harnessUrl = harness.url;

    this.api = new ApiProcess({
      repoRoot: REPO,
      port: options.apiPort,
      env: {
        // NODE_ENV is deliberately left as the developer's own. Setting
        // it to 'production' turns on env.validation.ts's OAuth checks,
        // which require https:// callback URLs and refuse to boot
        // against a local .env — a guard that is right for a deployment
        // and irrelevant to a rig measuring the media plane. Every
        // performance-relevant setting is passed explicitly below
        // instead, so nothing here depends on the mode.
        DATABASE_URL: dbUrl,
        DIRECT_URL: dbUrl,
        REDIS_URL: redisUrl,
        SFU_REGISTRATION_SECRET: this.registrationSecret,
        API_PUBLIC_URL: `http://127.0.0.1:${options.apiPort}`,
        // Raised only for the tiers that exceed it, and always recorded
        // alongside the result. The shipped default stays 50; this rig
        // exists to find out what the number should be, which it cannot
        // do while the current guess is enforcing itself.
        SIGNALING_MAX_PARTICIPANTS_PER_ROOM: String(options.maxParticipants ?? 250),
        // Every viewer in this rig connects from 127.0.0.1, and
        // SIGNALING_MAX_CONNECTIONS_PER_WINDOW is keyed by client IP with
        // a default of 20. Left alone, the 21st viewer's WebSocket
        // upgrade is refused with RATE_LIMITED before authentication, the
        // SDK retries, the retries are refused too, and the room
        // collapses — which is exactly what happened the first time this
        // rig was pointed at 25 viewers.
        //
        // Raised here so the media plane is what is being measured. It is
        // *not* purely a rig artefact, and the report says so: an
        // audience behind one corporate NAT or one carrier's CGNAT shares
        // a single budget in production too.
        SIGNALING_MAX_CONNECTIONS_PER_WINDOW: String(options.maxConnectionsPerWindow ?? 5_000),
        // The shipped default is 600s, which is shorter than this rig's
        // own scenarios. A thirty-minute sustained run or a two-hour
        // soak outlives a ten-minute token, and the SDK refuses an
        // expired one client-side before it opens a socket — so the
        // failure arrives as every viewer reporting TOKEN_EXPIRED, which
        // reads in the results as a media collapse and is nothing of the
        // kind. Raised for the rig only; the default is untouched, and
        // the report notes that a real deployment streaming for longer
        // than its token TTL needs a refresh path.
        RTC_TOKEN_DEFAULT_TTL_SECONDS: String(options.rtcTokenTtlSeconds ?? 6 * 60 * 60),
        ...options.apiEnv,
      },
    });
    this.note('api.start', { message: `port ${options.apiPort}` });
    await this.api.start();

    this.control = new ControlPlane(this.api.baseUrl);

    this.sfu =
      options.sfuMode === 'docker'
        ? new DockerSfuProcess({
            containerName: `raven-capacity-sfu-${this.runId}`,
            nodeId: this.nodeId,
            httpPort: options.sfuHttpPort,
            // Narrower than the host run's range on purpose: Docker
            // publishes UDP ports one at a time, and a 600-port range
            // takes minutes to bind and holds 600 host sockets. Phase 10
            // runs a handful of viewers, so it does not need the span.
            udpMin: options.sfuUdpMin,
            udpMax: options.sfuUdpMax,
            apiPort: options.apiPort,
            registrationSecret: this.registrationSecret,
            roomCapacity: options.sfuRoomCapacity,
          })
        : new SfuProcess({
            binary: this.sfuBinary,
            nodeId: this.nodeId,
            httpPort: options.sfuHttpPort,
            udpMin: options.sfuUdpMin,
            udpMax: options.sfuUdpMax,
            controlPlaneUrl: this.api.baseUrl,
            registrationSecret: this.registrationSecret,
            roomCapacity: options.sfuRoomCapacity,
          });
    this.note('sfu.start', {
      message: `${this.nodeId} (${options.sfuMode ?? 'host'}) http=${options.sfuHttpPort} udp=${options.sfuUdpMin}-${options.sfuUdpMax}`,
    });
    await this.sfu.start(() => this.isSfuRegistered());

    this.apiSampler = new ProcessTreeSampler('api', this.api.pid);
    // A containerised node has no host pid; its CPU and RSS come from
    // the process collectors on its own /metrics instead, which is the
    // more accurate source anyway.
    this.sfuProcSampler = this.sfu.pid
      ? new ProcessTreeSampler('sfu', this.sfu.pid)
      : {
          sample: async () => ({ name: 'sfu', processCount: 0, rssMb: null, cpuSecondsTotal: null, cpuPercent: null }),
        };

    // Generated once and cached on disk; the first run for a profile
    // pays a few seconds of ffmpeg. Absent ffmpeg this returns undefined
    // and the rig falls back to Chromium's own pattern — which still
    // measures, but measures a cheaper stream, and the result records
    // which was used so the two are never mixed up.
    this.videoFile = options.content === 'synthetic' ? undefined : await ensureContent(options.profile);
    this.contentKind = this.videoFile ? 'y4m-complex' : 'chromium-synthetic';
    this.note('content', { message: this.contentKind });

    this.browser = await launchBrowser({ headless: options.headless !== false, videoFile: this.videoFile });
    this.browserSampler = new BrowserTreeSampler(chromiumExecutablePath());

    this.note('stack.ready', {});
    return this;
  }

  async isSfuRegistered() {
    const rows = await this.db.query('SELECT status FROM rtc_servers WHERE name = $1', [this.nodeId]);
    return rows.length > 0 && rows[0].status === 'HEALTHY';
  }

  /** Creates a project, an API key, a stream, and starts it with a publishing host. */
  async openStream({ title, profile = this.options.profile, audio = true } = {}) {
    await this.control.provision(this.runId);
    const stream = await this.control.createStream(title ?? `Capacity ${this.runId}`, 'host');
    this.streamId = stream.id;
    this.roomId = await this.db.roomIdForStream(stream.id);
    this.chatRootMessageId = stream.chatRootMessageId ?? null;

    const hostCredential = await this.control.addHost(this.streamId, 'host', 'HOST');
    await this.control.startStream(this.streamId);

    this.host = new Host({
      browser: this.browser,
      harnessUrl: this.harnessUrl,
      credentials: { streamId: this.streamId, ...hostCredential, chatRootMessageId: this.chatRootMessageId },
      profile,
      audio,
      onLog: (who, line) => this.pageLogSink.push(`[${who}] ${line}`),
    });
    const hostState = await this.host.start();
    this.note('host.publishing', {
      message: `${hostState.capturedSettings?.width}x${hostState.capturedSettings?.height}@${hostState.capturedSettings?.frameRate} kinds=${hostState.publishedKinds.join('+')}`,
    });
    return hostState;
  }

  /**
   * Decodes an RTC token's lifetime without verifying it.
   *
   * The SDK refuses a token whose `exp` is already past, client-side,
   * before it opens a socket — so an expired credential surfaces as
   * every viewer failing with TOKEN_EXPIRED and no server-side trace at
   * all. Checking at the mint means the rig blames the mint rather than
   * reporting a media failure that was never about media.
   */
  static tokenLifetime(token) {
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
      return {
        iat: payload.iat ?? null,
        exp: payload.exp ?? null,
        remainingMs: (payload.exp ?? 0) * 1000 - Date.now(),
      };
    } catch {
      return { iat: null, exp: null, remainingMs: null };
    }
  }

  /** Mints N real viewer credentials. Returns seats plus the mint outcome, so refusals are visible rather than silent. */
  async mintSeats(count, offset = 0, { chat = false } = {}) {
    const identities = Array.from({ length: count }, (_, i) => `viewer-${offset + i}`);
    const minted = await this.control.mintViewerTokens(this.streamId, identities);
    const seats = [];
    const refusals = [];
    const lifetimes = [];
    minted.forEach((result, i) => {
      if (!result.ok) {
        refusals.push({ identity: identities[i], status: result.status, code: result.code, message: result.message });
        return;
      }
      const credentials = { streamId: this.streamId, ...result.credentials, chatRootMessageId: this.chatRootMessageId };
      if (!chat) delete credentials.chat;
      lifetimes.push(Rig.tokenLifetime(credentials.rtc.token));
      seats.push({ id: identities[i], credentials });
    });

    const shortest = lifetimes.reduce(
      (min, l) => (l.remainingMs != null && l.remainingMs < min ? l.remainingMs : min),
      Infinity,
    );
    if (shortest !== Infinity && shortest < 60_000) {
      // Loud, because a whole tier of TOKEN_EXPIRED failures looks
      // exactly like a media failure in the results and is not one.
      this.note('mint.short-ttl', {
        message: `shortest viewer token has ${Math.round(shortest / 1000)}s left — RTC_TOKEN_DEFAULT_TTL_SECONDS is too short for this run`,
      });
    }

    return {
      seats,
      refusals,
      mintMs: minted.map((r) => r.mintMs),
      shortestTtlMs: shortest === Infinity ? null : shortest,
    };
  }

  async seatAudience(seats, { chat = false } = {}) {
    this.audience = new Audience({
      browser: this.browser,
      harnessUrl: this.harnessUrl,
      seats,
      perPage: this.options.perPage,
      staggerMs: this.options.staggerMs,
      chat,
      onPageLog: (who, line) => {
        if (this.pageLogSink.length < 5_000) this.pageLogSink.push(`[${who}] ${line}`);
      },
    });
    await this.audience.open();
    const joinWallMs = await this.audience.joinAll();
    this.note('audience.joined', {
      message: `${seats.length} viewers in ${joinWallMs}ms across ${this.audience.shards.length} shards`,
    });
    return joinWallMs;
  }

  /**
   * One observation of the whole system at one instant: the audience, the
   * SFU, the API, the rig's own browsers, Redis, and the machine.
   *
   * Everything is captured together so that a viewer-side degradation can
   * always be attributed. Falling frame rate with flat SFU CPU and a
   * saturated load average is the rig running out of machine; falling
   * frame rate with SFU CPU pinned is the SFU running out of machine.
   * They are different findings and only a joint sample can tell them
   * apart.
   */
  async observe() {
    const [viewers, sfuMetrics, apiProc, sfuProc, browserProc, hostSend, redisCount, redisKeys] = await Promise.all([
      this.audience ? this.audience.sample() : Promise.resolve([]),
      scrapeSfu(this.sfu.metricsUrl).catch((err) => ({ error: err.message, at: Date.now() })),
      this.apiSampler.sample(),
      this.sfuProcSampler.sample(),
      this.browserSampler.sample(),
      this.host ? this.host.sendStats() : Promise.resolve(null),
      this.roomId ? this.redis.roomParticipantCount(this.roomId) : Promise.resolve(null),
      this.redis.signalingKeyCount(),
    ]);

    const rates = sfuMetrics.error ? null : deriveRates(this.previousSfuScrape, sfuMetrics);
    this.previousSfuScrape = sfuMetrics.error ? this.previousSfuScrape : sfuMetrics;

    return {
      at: Date.now(),
      // How the audience was distributed when this sample was taken.
      // Recorded on every observation because it is the difference
      // between "100 viewers" and "100 viewers, ten to a renderer", and
      // a reader cannot judge the result without it.
      shardLayout: this.audience?.shardLayout ?? null,
      viewers,
      sfu: { raw: sfuMetrics, rates },
      processes: { api: apiProc, sfu: sfuProc, browser: browserProc },
      hostSend,
      redis: { roomParticipants: redisCount, signalingKeys: redisKeys },
      system: systemSnapshot(),
    };
  }

  async down() {
    await this.audience?.close();
    await this.host?.close();
    await this.browser?.close().catch(() => {});
    await this.sfu?.stop();
    await this.api?.stop();
    await new Promise((resolve) => this.harnessServer?.close(() => resolve()) ?? resolve());
    await this.redis?.close();
    await this.db?.close();
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
