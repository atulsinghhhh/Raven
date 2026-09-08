import { Injectable } from '@nestjs/common';
import { Counter, Registry } from 'prom-client';

/**
 * Email counters, kept out of MetricsService so the dependency runs one
 * way only: MetricsModule imports EmailModule, never the reverse. Auth
 * already imports EmailModule, and MetricsService already imports the chat
 * and signaling gateways — wiring it the other way would close a cycle.
 *
 * Unregistered until MetricsService calls registerOn() at boot, so a unit
 * test that constructs EmailService alone records into nothing rather than
 * leaking metric registrations between test files (prom-client throws on a
 * duplicate metric name in one registry).
 */
@Injectable()
export class EmailMetricsService {
  private attempted?: Counter<'type'>;
  private sent?: Counter<'type'>;
  private failed?: Counter<'type' | 'reason'>;
  private skipped?: Counter<'type' | 'reason'>;

  registerOn(registry: Registry): void {
    if (this.attempted) {
      return;
    }

    this.attempted = new Counter({
      name: 'raven_emails_attempted_total',
      help: 'Emails Raven tried to send, including ones the free-tier guard then skipped',
      labelNames: ['type'],
      registers: [registry],
    });

    this.sent = new Counter({
      name: 'raven_emails_sent_total',
      help: 'Emails Resend accepted. Accepted is not delivered — delivery lives in Resend’s own dashboard',
      labelNames: ['type'],
      registers: [registry],
    });

    this.failed = new Counter({
      name: 'raven_emails_failed_total',
      help: 'Emails that were not accepted, by reason (permanent, transient_exhausted, provider_quota)',
      labelNames: ['type', 'reason'],
      registers: [registry],
    });

    this.skipped = new Counter({
      name: 'raven_emails_skipped_total',
      help: 'Emails not attempted, by reason (disabled, cooldown, daily_quota, monthly_quota)',
      labelNames: ['type', 'reason'],
      registers: [registry],
    });
  }

  recordAttempt(type: string): void {
    this.attempted?.inc({ type });
  }

  recordSent(type: string): void {
    this.sent?.inc({ type });
  }

  recordFailure(type: string, reason: string): void {
    this.failed?.inc({ type, reason });
  }

  recordSkip(type: string, reason: string): void {
    this.skipped?.inc({ type, reason });
  }
}
