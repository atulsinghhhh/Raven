import { config } from './config.js';
import { EgressSession, type EgressHeartbeat, type EgressStartRequest } from './egress-session.js';
import type { StorageDriver } from './storage/storage-driver.js';

/**
 * One process can run more than one stream's egress concurrently — each
 * `EgressSession` owns its own Chromium page and ffmpeg subprocess, fully
 * isolated from the others. Keyed by the stream's public id, the same id
 * the API's start/stop requests and this worker's own heartbeats use.
 */
export class EgressManager {
  private readonly sessions = new Map<string, EgressSession>();

  constructor(
    private readonly storage: StorageDriver,
    private readonly harnessBaseUrl: string,
  ) {}

  async start(request: EgressStartRequest): Promise<void> {
    if (this.sessions.has(request.streamId)) {
      // A second start for a stream already running is treated as a no-op
      // rather than an error — the API's own start() call is best-effort
      // and may retry after a slow/ambiguous response.
      return;
    }

    const session = new EgressSession(
      request,
      this.storage,
      (payload) => void this.reportHeartbeat(payload),
      this.harnessBaseUrl,
    );
    this.sessions.set(request.streamId, session);
    await session.start();
  }

  async stop(streamId: string): Promise<void> {
    const session = this.sessions.get(streamId);
    if (!session) return; // never started here, or already stopped — idempotent
    this.sessions.delete(streamId);
    await session.stop();
    await session.cleanupWorkDir();
  }

  private async reportHeartbeat(payload: EgressHeartbeat): Promise<void> {
    try {
      await fetch(config.apiHeartbeatUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.sharedSecret}` },
        body: JSON.stringify(payload),
      });
    } catch {
      // Best-effort: a dropped heartbeat is recovered by the API's own
      // staleness sweep (EgressControlService.sweepStale) if it keeps
      // failing; a single miss must not crash the session.
    }
  }
}

export type { StorageDriver };
