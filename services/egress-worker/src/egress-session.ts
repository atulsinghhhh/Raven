import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { config } from './config.js';
import type { StorageDriver } from './storage/storage-driver.js';

export interface EgressStartRequest {
  streamId: string; // stream_... public id
  roomId: string;
  rtcToken: string;
  rtcEndpoint: string;
  iceServers?: unknown[];
}

export interface EgressHeartbeat {
  streamId: string;
  workerId: string;
  hostConnected: boolean;
  ffmpegAlive: boolean;
  manifestReachable: boolean;
  playbackUrl?: string;
  error?: string;
}

export type HeartbeatSink = (payload: EgressHeartbeat) => void;

/**
 * One BROADCAST-mode stream's egress run: joins the room as an ordinary,
 * internal (publish:false) viewer via a real headless Chromium page
 * running the actual `@ravenkash/client` package (see harness/viewer.js),
 * relays the host's real decoded media into ffmpeg, segments to HLS, and
 * uploads every new/changed file to the configured `StorageDriver`.
 *
 * Deliberately does not touch `services/sfu` — this joins over the exact
 * same signaling/RTC path any real viewer already uses.
 */
export class EgressSession {
  private browser?: Browser;
  private page?: Page;
  private ffmpeg?: ChildProcessByStdio<Writable, null, Readable>;
  private heartbeatTimer?: NodeJS.Timeout;
  private segmentWatchTimer?: NodeJS.Timeout;
  private uploadedMtimes = new Map<string, number>();
  private hostConnected = false;
  private manifestReachable = false;
  private stopped = false;
  private lastError: string | undefined;
  private lastFfmpegOutput: string | undefined;

  private readonly outDir: string;
  private readonly manifestKey: string;

  constructor(
    private readonly request: EgressStartRequest,
    private readonly storage: StorageDriver,
    private readonly heartbeatSink: HeartbeatSink,
    private readonly harnessBaseUrl: string,
  ) {
    this.outDir = join(config.workDir, this.request.streamId);
    this.manifestKey = `${this.request.streamId}/index.m3u8`;
  }

  get playbackUrl(): string {
    return this.storage.publicUrlFor(this.manifestKey);
  }

  async start(): Promise<void> {
    await mkdir(this.outDir, { recursive: true });

    this.ffmpeg = this.spawnFfmpeg();
    await this.launchHarness();

    this.segmentWatchTimer = setInterval(() => void this.uploadNewSegments(), 1000);
    this.heartbeatTimer = setInterval(() => void this.sendHeartbeat(), config.heartbeatIntervalMs);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.segmentWatchTimer) clearInterval(this.segmentWatchTimer);

    try {
      await this.page?.evaluate(() => window.__leave?.());
    } catch {
      // best-effort — the room may already be gone (host ended the stream)
    }
    await this.page?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);

    // ffmpeg writes #EXT-X-ENDLIST and a final, valid manifest once its
    // stdin closes cleanly — this is what makes an ended stream's HLS
    // playback stop rather than hang waiting for a segment that never
    // arrives.
    this.ffmpeg?.stdin.end();
    await new Promise<void>((resolve) => {
      if (!this.ffmpeg || this.ffmpeg.exitCode !== null) return resolve();
      this.ffmpeg.once('exit', () => resolve());
      setTimeout(resolve, 5000); // don't hang stop() forever on a wedged ffmpeg
    });

    await this.uploadNewSegments(); // final pass, catches the ENDLIST manifest
  }

  private spawnFfmpeg(): ChildProcessByStdio<Writable, null, Readable> {
    const args = [
      '-f', 'webm',
      '-i', 'pipe:0',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      // Forces a keyframe every hls_time seconds of PTS, regardless of the
      // source's actual frame rate. Without this, libx264's default GOP
      // (~250 frames — several times hls_time at a typical camera frame
      // rate) is the earliest point HLS can legally cut a segment, so the
      // *first* segment silently comes out several times longer than
      // configured and every segment after it inherits the same drift.
      '-force_key_frames', `expr:gte(t,n_forced*${config.hlsSegmentSeconds})`,
      '-c:a', 'aac',
      '-f', 'hls',
      '-hls_time', String(config.hlsSegmentSeconds),
      '-hls_list_size', String(config.hlsListSize),
      '-hls_flags', 'delete_segments+append_list',
      '-hls_segment_filename', join(this.outDir, 'seg_%05d.ts'),
      join(this.outDir, 'index.m3u8'),
    ];

    const proc = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
    proc.stderr.on('data', (chunk: Buffer) => {
      // ffmpeg's stderr is its normal progress channel (frame=... fps=...),
      // not an error signal — this is diagnostic context for *if* the
      // process dies unexpectedly, never surfaced as `lastError` on its
      // own, or every healthy heartbeat would report a false failure.
      this.lastFfmpegOutput = chunk.toString('utf8').trim().split('\n').pop();
      // eslint-disable-next-line no-console
      console.log(`[ffmpeg:${this.request.streamId}] ${this.lastFfmpegOutput}`);
    });
    proc.on('exit', (code) => {
      if (!this.stopped && code !== 0) {
        this.lastError = `ffmpeg exited unexpectedly with code ${code}: ${this.lastFfmpegOutput ?? '(no output captured)'}`;
      }
    });
    return proc;
  }

  private async launchHarness(): Promise<void> {
    this.browser = await chromium.launch({
      headless: true,
      // This page never publishes, but headless Chromium has no real audio
      // output device at all without this flag — and MediaRecorder's audio
      // encode path needs a device to synchronize against even to *receive*
      // and mux an incoming Opus track, not just to capture one. Without
      // it, MediaRecorder silently never fires `ondataavailable` at all
      // once an audio track is added to its MediaStream (video-only
      // recording is unaffected, which is what made this so easy to miss).
      args: ['--use-fake-device-for-media-stream'],
    });
    this.page = await this.browser.newPage();
    // The harness page's own console is the only window into whether the
    // join/subscribe actually happened — surfacing it here is cheap and is
    // what makes a stuck/silent session diagnosable instead of a black box.
    this.page.on('console', (msg) => {
      // eslint-disable-next-line no-console
      console.log(`[egress:${this.request.streamId}:page] ${msg.text()}`);
    });
    this.page.on('pageerror', (err) => {
      // eslint-disable-next-line no-console
      console.error(`[egress:${this.request.streamId}:pageerror] ${err.message}`);
    });

    await this.page.exposeFunction('__onChunk', (base64: string) => {
      // eslint-disable-next-line no-console
      console.log(`[egress:${this.request.streamId}] chunk received: ${base64.length} base64 chars, ffmpeg=${!!this.ffmpeg} stdinDestroyed=${this.ffmpeg?.stdin.destroyed}`);
      if (this.ffmpeg && !this.ffmpeg.stdin.destroyed) {
        this.ffmpeg.stdin.write(Buffer.from(base64, 'base64'));
      }
    });

    await this.page.exposeFunction('__onEvent', (event: { type: string; message?: string; code?: string }) => {
      if (event.type === 'joined' || event.type === 'recording') this.hostConnected = true;
      if (event.type === 'joinFailed' || event.type === 'roomError') {
        this.lastError = event.message ?? event.code ?? event.type;
      }
    });

    await this.page.goto(`${this.harnessBaseUrl}/viewer.html`);
    await this.page.waitForFunction(() => window.__ready === true);

    const credentials = {
      streamId: this.request.streamId,
      role: 'VIEWER' as const,
      rtc: {
        token: this.request.rtcToken,
        endpoint: this.request.rtcEndpoint,
        iceServers: this.request.iceServers,
      },
    };
    await this.page.evaluate((creds) => window.__join(creds), credentials);
  }

  private async uploadNewSegments(): Promise<void> {
    let files: string[];
    try {
      files = await readdir(this.outDir);
    } catch {
      return; // ffmpeg hasn't created the directory's contents yet
    }

    for (const file of files) {
      if (!file.endsWith('.ts') && !file.endsWith('.m3u8')) continue;
      const path = join(this.outDir, file);
      const info = await stat(path).catch(() => undefined);
      if (!info) continue;

      const previous = this.uploadedMtimes.get(file);
      if (previous === info.mtimeMs) continue; // unchanged since the last pass

      const body = await readFile(path);
      const contentType = file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t';
      await this.storage.upload(`${this.request.streamId}/${file}`, body, contentType);
      this.uploadedMtimes.set(file, info.mtimeMs);
    }
  }

  private async sendHeartbeat(): Promise<void> {
    try {
      const response = await fetch(this.playbackUrl, { method: 'HEAD' });
      this.manifestReachable = response.ok;
    } catch {
      this.manifestReachable = false;
    }

    this.heartbeatSink({
      streamId: this.request.streamId,
      workerId: config.workerId,
      hostConnected: this.hostConnected,
      ffmpegAlive: this.ffmpeg?.exitCode === null,
      manifestReachable: this.manifestReachable,
      playbackUrl: this.manifestReachable ? this.playbackUrl : undefined,
      error: this.lastError,
    });
  }

  /** Best-effort cleanup of local scratch files once a stream's egress is fully torn down. */
  async cleanupWorkDir(): Promise<void> {
    await rm(this.outDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

declare global {
  interface Window {
    __ready?: boolean;
    __join: (credentials: unknown) => Promise<void>;
    __leave: () => Promise<void>;
  }
}
