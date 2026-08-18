import type { Logger } from '../../logger';
import { generateConnectionId } from './connection-id';
import { detectPlatform } from './platform';

export interface TelemetryClient {
  readonly connectionId: string;
  /**
   * Fire-and-forget — never returns a promise the caller is expected to
   * await, never throws. See docs/telemetry.md#reliability and Phase 9
   * spec §11: "RTC must continue working even if telemetry fails."
   */
  send(type: string, data?: Record<string, unknown>): void;
}

export interface TelemetryClientOptions {
  enabled: boolean;
  telemetryUrl?: string;
  token: string;
  sdkVersion: string;
  logger: Logger;
}

/**
 * Creates a real (HTTP) telemetry client when telemetry is enabled and a
 * `telemetryUrl` was provided, or a no-op one otherwise — callers never
 * need to branch on whether telemetry is active, they just call
 * `send()` unconditionally. Either way `connectionId` is always real and
 * stable, since it's also used as the SDK's own public `room.connectionId`
 * regardless of whether telemetry is enabled.
 */
export function createTelemetryClient(options: TelemetryClientOptions): TelemetryClient {
  const connectionId = generateConnectionId();

  if (!options.enabled || !options.telemetryUrl) {
    return { connectionId, send: () => {} };
  }

  return new HttpTelemetryClient(connectionId, options);
}

class HttpTelemetryClient implements TelemetryClient {
  constructor(
    readonly connectionId: string,
    private readonly options: TelemetryClientOptions,
  ) {}

  send(type: string, data: Record<string, unknown> = {}): void {
    const body = {
      connectionId: this.connectionId,
      type,
      data: { sdkVersion: this.options.sdkVersion, ...detectPlatform(), ...data },
    };

    try {
      // Deliberately not awaited by any caller, and every failure mode
      // (network error, non-2xx, telemetryUrl unreachable) is swallowed
      // here — a telemetry outage must never surface as an RTC error.
      // `keepalive: true` gives this a real chance to complete even
      // during a page unload/tab close (e.g. the final "disconnected"
      // event), the same problem `navigator.sendBeacon` solves — beacon
      // itself isn't usable here since it can't carry the Authorization
      // header this endpoint requires.
      fetch(`${this.options.telemetryUrl}/v1/telemetry/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.options.token}` },
        body: JSON.stringify(body),
        keepalive: true,
      })
        .then((res) => {
          if (!res.ok) {
            this.options.logger.debug('telemetry event rejected', type, res.status);
          }
        })
        .catch((error) => {
          this.options.logger.debug('telemetry event failed', type, (error as Error).message);
        });
    } catch (error) {
      this.options.logger.debug('telemetry send threw synchronously', type, (error as Error).message);
    }
  }
}
