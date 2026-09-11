/**
 * The audience: real Chromium, real PeerConnections, sharded across pages.
 *
 * # The shape of the rig, and what it does and does not prove
 *
 * Every viewer here has its own RTC token minted by the real API, its own
 * `RTCPeerConnection`, its own DTLS-SRTP session and its own decoder. The
 * SFU sees N independent subscribers and builds N downtracks, which is
 * the work a capacity number is about.
 *
 * What is shared is a renderer process per shard. That is a real
 * difference from N real devices and it is stated in the report rather
 * than glossed: it removes N process heaps and N compositors, neither of
 * which the SFU can see, and it adds contention on one main thread, which
 * the *viewer-side* numbers can see. The mitigation is to keep shards
 * small and to watch for the tell — if the rig were the limit, decoded
 * frame rate would fall while SFU CPU and outbound Mbps stayed flat.
 * Every sample records both sides so that question is answerable from the
 * data rather than by assertion.
 */
import { chromium } from 'playwright';

/** Chromium needs a synthetic camera; without this the host's getUserMedia never resolves headless. */
export const CHROMIUM_MEDIA_ARGS = [
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
  // The default fake device is a rolling colour pattern, which is exactly
  // what a liveness check wants: every frame differs from the last, so a
  // frozen decoder cannot be mistaken for a static scene.
  '--autoplay-policy=no-user-gesture-required',
  // Headless Chromium otherwise throttles timers and rAF in backgrounded
  // pages. At 10 shards, most are backgrounded most of the time, and a
  // throttled page stops pulling frames — a stall the harness would cause
  // and then measure.
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-features=CalculateNativeWinOcclusion',
];

export async function launchBrowser({ headless = true, videoFile } = {}) {
  const args = [...CHROMIUM_MEDIA_ARGS];
  if (videoFile) {
    // Replaces the built-in colour wheel with a looped Y4M whose encoded
    // bitrate resembles real camera video. See lib/content.mjs for why
    // the default synthesises a misleadingly cheap stream. Browser-wide
    // rather than per-context because Chromium takes it as a process
    // flag; harmless for the viewer shards, which never open a camera.
    args.push(`--use-file-for-fake-video-capture=${videoFile}`);
  }
  return chromium.launch({ headless, args });
}

/** Where Playwright's own Chromium lives. Used to find the rig's browser processes; see BrowserTreeSampler. */
export function chromiumExecutablePath() {
  return chromium.executablePath();
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export class Audience {
  /**
   * @param seats [{ id, credentials }] — one real minted viewer credential each
   */
  constructor({ browser, harnessUrl, seats, perPage = 10, staggerMs = 120, chat = false, onPageLog }) {
    this.browser = browser;
    this.harnessUrl = harnessUrl;
    this.seats = seats;
    this.perPage = perPage;
    this.staggerMs = staggerMs;
    this.chat = chat;
    this.onPageLog = onPageLog;
    this.shards = [];
    /** Ids that have left or been killed. A shard's live occupancy is its seats minus these. */
    this.departed = new Set();
  }

  get shardLayout() {
    return { viewers: this.seats.length, shards: this.shards.length, perPage: this.perPage };
  }

  /** Opens one shard page and registers its seats. Does not join them. */
  async #openShard(group) {
    const index = this.shards.length;
    const context = await this.browser.newContext({ permissions: ['camera', 'microphone'] });
    const page = await context.newPage();
    const consoleLines = [];
    page.on('console', (msg) => {
      consoleLines.push(msg.text());
      this.onPageLog?.(`shard${index}`, msg.text());
    });
    page.on('pageerror', (err) => {
      consoleLines.push(`PAGEERROR ${err.stack ?? err.message}`);
      this.onPageLog?.(`shard${index}`, `PAGEERROR ${err.message}`);
    });

    const params = new URLSearchParams({ stagger: String(this.staggerMs), chat: String(this.chat) });
    await page.goto(`${this.harnessUrl}/viewer.html?${params}`);
    try {
      await page.waitForFunction(() => window.__ready === true, undefined, { timeout: 60_000 });
    } catch (err) {
      // A bare "waitForFunction timed out" says nothing about why the
      // module never finished evaluating. The page's own console is the
      // only place that answer exists.
      throw new Error(
        `viewer shard ${index} never became ready: ${err.message}\n--- page console ---\n${consoleLines.slice(-40).join('\n')}`,
      );
    }
    const shard = { index, context, page, seatIds: [] };
    this.shards.push(shard);
    if (group?.length) {
      // Registered but not joined. `open()` seats everyone first and
      // then joins every shard at once, so that the arrival rate the
      // API and SFU see is an audience turning up rather than one page
      // at a time.
      await shard.page.evaluate((s) => window.__setSeats(s), group);
      shard.seatIds.push(...group.map((s) => s.id));
    }
    return shard;
  }

  async open() {
    for (const group of chunk(this.seats, this.perPage)) {
      await this.#openShard(group);
    }
    return this;
  }

  /**
   * Joins every viewer.
   *
   * Shards join in parallel with each other and sequentially within
   * themselves. Sequential-within-a-shard is required by the
   * PeerConnection tag in pc-tap.js; parallel-across-shards is what makes
   * the arrival rate resemble an audience rather than a queue, and it is
   * what puts the credential-mint and signaling paths under simultaneous
   * load the way a host going live does.
   */
  async joinAll() {
    const startedAt = Date.now();
    await Promise.all(
      this.shards.map((shard) =>
        shard.page.evaluate(() => window.__joinAll()).catch((err) => ({ error: err.message })),
      ),
    );
    return Date.now() - startedAt;
  }

  async sample() {
    const perShard = await Promise.all(
      this.shards.map((shard) =>
        shard.page
          .evaluate(() => window.__sample())
          .catch((err) => [{ id: `shard-${shard.index}-unreachable`, live: false, error: { message: err.message } }]),
      ),
    );
    return perShard.flat();
  }

  shardFor(seatId) {
    return this.shards.find((shard) => shard.seatIds.includes(seatId));
  }

  async leave(ids) {
    const byShard = new Map();
    for (const id of ids) {
      const shard = this.shardFor(id);
      if (!shard) continue;
      byShard.set(shard, [...(byShard.get(shard) ?? []), id]);
    }
    await Promise.all([...byShard].map(([shard, shardIds]) => shard.page.evaluate((x) => window.__leave(x), shardIds)));
    for (const id of ids) this.departed.add(id);
  }

  async kill(ids) {
    const byShard = new Map();
    for (const id of ids) {
      const shard = this.shardFor(id);
      if (!shard) continue;
      byShard.set(shard, [...(byShard.get(shard) ?? []), id]);
    }
    await Promise.all([...byShard].map(([shard, shardIds]) => shard.page.evaluate((x) => window.__kill(x), shardIds)));
    for (const id of ids) this.departed.add(id);
  }

  /**
   * Adds viewers mid-run, opening new shard pages as needed.
   *
   * Filling the existing shards and stopping there was the first
   * version, and it quietly defeated the whole sharding scheme: a ramp
   * from 10 to 100 opened one page at the first tier and then piled the
   * other ninety viewers into that same renderer. The tier would still
   * have produced numbers, and they would have been a measurement of
   * one Chromium main thread rather than of the SFU.
   *
   * Existing shards are topped up to `perPage` first, so a churn cycle
   * that replaces ten viewers reuses the pages it just emptied instead
   * of growing the browser without bound.
   */
  async add(newSeats) {
    const remaining = [...newSeats];
    const work = [];

    // `__joinSeats` both registers and joins, so nothing here goes
    // through `__setSeats` — doing both would enter each seat twice.
    for (const shard of this.shards) {
      if (remaining.length === 0) break;
      const room = this.perPage - shard.seatIds.filter((id) => !this.departed.has(id)).length;
      if (room <= 0) continue;
      const group = remaining.splice(0, room);
      shard.seatIds.push(...group.map((s) => s.id));
      work.push(shard.page.evaluate((x) => window.__joinSeats(x), group));
    }

    while (remaining.length > 0) {
      const group = remaining.splice(0, this.perPage);
      const shard = await this.#openShard();
      shard.seatIds.push(...group.map((s) => s.id));
      work.push(shard.page.evaluate((x) => window.__joinSeats(x), group));
    }

    await Promise.all(work);
  }

  async pageLogs() {
    const logs = await Promise.all(
      this.shards.map(
        async (shard) => `--- shard ${shard.index} ---\n${await shard.page.evaluate(() => window.__log())}`,
      ),
    );
    return logs.join('\n');
  }

  async close() {
    for (const shard of this.shards) {
      await shard.context.close().catch(() => {});
    }
    this.shards = [];
  }
}

/** The publishing side. One page, one host. */
export class Host {
  constructor({ browser, harnessUrl, credentials, profile = '360p', audio = true, onLog }) {
    Object.assign(this, { browser, harnessUrl, credentials, profile, audio, onLog });
  }

  async start() {
    this.context = await this.browser.newContext({ permissions: ['camera', 'microphone'] });
    this.page = await this.context.newPage();
    if (this.onLog) {
      this.page.on('console', (msg) => this.onLog('host', msg.text()));
      this.page.on('pageerror', (err) => this.onLog('host', `PAGEERROR ${err.message}`));
    }
    const params = new URLSearchParams({
      credentials: encodeURIComponent(JSON.stringify(this.credentials)),
      profile: this.profile,
      audio: String(this.audio),
    });
    await this.page.goto(`${this.harnessUrl}/host.html?${params}`);
    await this.page
      .waitForFunction(() => window.__state?.ready === true || window.__state?.error, undefined, { timeout: 90_000 })
      .catch(() => {});
    const state = await this.page.evaluate(() => window.__state);
    if (!state?.ready) {
      throw new Error(
        `host failed to publish: ${JSON.stringify(state?.error)}\n${await this.page.evaluate(() => window.__log())}`,
      );
    }
    this.state = state;
    return state;
  }

  sendStats() {
    return this.page.evaluate(() => window.__sendStats()).catch(() => null);
  }

  state_() {
    return this.page.evaluate(() => window.__state).catch(() => null);
  }

  logs() {
    return this.page.evaluate(() => window.__log()).catch(() => '');
  }

  async close() {
    await this.context?.close().catch(() => {});
  }
}
