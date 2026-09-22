import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { checkTurnAllocate } from './dependency-checks.util';

interface HostHealth {
  healthy: boolean;
  lastCheckedAt: number;
  lastError?: string;
}

/**
 * The continuous version of infrastructure/azure/08-verify.sh's one-time
 * "does coturn actually authenticate a real credential" assertion
 * (10k-scaling audit Phase 4). That script only ever runs at deploy time;
 * this runs `checkTurnAllocate` against every configured TURN host
 * (`turn.internalHosts`) on an interval for as long as the process is up,
 * which is what closes the gap the audit's Redis/TURN pass found: "no
 * TURN health state machine feeding allocation or credential minting" —
 * the SFU fleet has HEALTHY/DRAINING/UNHEALTHY; TURN had nothing.
 *
 * Deliberately does not feed anything back into token minting yet —
 * RtcTokensService still hands out every configured host regardless of
 * this service's verdict. Doing otherwise (dropping an unhealthy host
 * from the ICE server list) is a real design decision — does a client
 * that only needed TURN lose its one working relay path because this
 * service's own network path to it is degraded, independent of the
 * client's? — not a config-plumbing one, and the audit's own Phase 4
 * scope is "add a signal," not "wire it into allocation." That's
 * flagged as follow-up work, not silently done here.
 *
 * Runs independently on every API instance, same reasoning as
 * RtcServerRegistryService's stale-node sweep: the check is a read-only
 * network probe with no side effect worth coordinating, so N instances
 * running it costs N times the (tiny) load on coturn and nothing else —
 * cheaper than electing a leader for it.
 */
@Injectable()
export class TurnHealthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TurnHealthService.name);
  private timer?: NodeJS.Timeout;
  private readonly health = new Map<string, HostHealth>();
  private readonly failureCounts = new Map<string, number>();

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const secret = this.configService.get<string>('turn.secret');
    if (!secret) {
      // No TURN_SECRET configured at all — most likely local dev without
      // TURN wired up. Nothing to check, and checkTurnAllocate would just
      // fail every host for a reason that isn't a real outage.
      this.logger.log('TURN_SECRET not set — TURN health checking disabled');
      return;
    }

    const intervalSeconds = this.configService.get<number>('turn.healthCheckIntervalSeconds')!;
    // Run once immediately rather than waiting a full interval to learn
    // anything — the first /metrics scrape after boot should already
    // have real data, not silence.
    void this.runChecks();
    this.timer = setInterval(() => void this.runChecks(), intervalSeconds * 1000);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  private async runChecks(): Promise<void> {
    const hosts = this.configService.get<string[]>('turn.internalHosts') ?? [];
    const port = this.configService.get<number>('turn.port')!;
    const secret = this.configService.get<string>('turn.secret')!;

    await Promise.all(hosts.map((host) => this.checkOne(host, port, secret)));
  }

  private async checkOne(host: string, port: number, secret: string): Promise<void> {
    const result = await checkTurnAllocate(host, port, secret).catch((err) => ({
      ok: false as const,
      error: `unexpected error: ${(err as Error).message}`,
    }));

    const previous = this.health.get(host);
    const healthy = result.ok && !result.isPrivateRelay;
    const error = !result.ok ? result.error : result.isPrivateRelay ? 'relay address is private — external-ip is likely unset on this coturn node' : undefined;

    this.health.set(host, { healthy, lastCheckedAt: Date.now(), lastError: error });

    if (!healthy) {
      this.failureCounts.set(host, (this.failureCounts.get(host) ?? 0) + 1);
    }

    const isNewResult = previous === undefined;
    const changedState = previous !== undefined && previous.healthy !== healthy;
    if (healthy && (isNewResult || changedState)) {
      this.logger.log(`TURN host ${host} is healthy`);
    } else if (!healthy && (isNewResult || changedState)) {
      this.logger.warn(`TURN host ${host} is unhealthy: ${error}`);
    }
  }

  /** For MetricsService — mirrors every other per-instance gauge source in this codebase (see metrics.service.ts). */
  getMetrics(): { healthyByHost: Record<string, 0 | 1>; failuresByHost: Record<string, number> } {
    const healthyByHost: Record<string, 0 | 1> = {};
    for (const [host, state] of this.health) {
      healthyByHost[host] = state.healthy ? 1 : 0;
    }
    return { healthyByHost, failuresByHost: Object.fromEntries(this.failureCounts) };
  }
}
