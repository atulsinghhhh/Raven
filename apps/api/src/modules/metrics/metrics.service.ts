import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { WebhookDeliveryStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { EmailMetricsService } from '../email/email.metrics.service';
import { ChatGateway } from '../chat/gateway/chat.gateway';
import { SignalingGateway } from '../signaling/gateway/signaling.gateway';
import { SfuLinkService } from '../signaling/sfu/sfu-link.service';
import { RtcServerRegistryService } from '../rtc-servers/rtc-server-registry.service';

/**
 * Infrastructure metrics for Prometheus: a different concern from
 * `observability/metrics.service.ts`, which computes dashboard analytics
 * (connection success rate, etc.) from Postgres for developers to look
 * at in the dashboard. This one is for the platform's own operators:
 * RED metrics on the HTTP surface (via MetricsMiddleware) plus a small
 * set of gauges reusing state that already exists elsewhere rather than
 * tracking anything new.
 *
 * Every gauge below is by design local-instance-only (same values
 * `/health` reports). Prometheus sums across pods at query time
 * (`sum(raven_chat_connections_active)`), which is the standard pattern
 * and avoids a fleet-wide Redis read on every scrape. The one exception
 * is the webhook pending-deliveries gauge, which is a shared Postgres
 * queue depth by nature: every instance reports the same number, which
 * is correct for that metric.
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  private readonly httpRequestsTotal: Counter<'method' | 'route' | 'status'>;
  private readonly httpRequestDurationSeconds: Histogram<'method' | 'route' | 'status'>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly chatGateway: ChatGateway,
    private readonly signalingGateway: SignalingGateway,
    private readonly sfuLink: SfuLinkService,
    private readonly rtcServers: RtcServerRegistryService,
    private readonly emailMetrics: EmailMetricsService,
  ) {
    collectDefaultMetrics({ register: this.registry });

    this.httpRequestsTotal = new Counter({
      name: 'raven_http_requests_total',
      help: 'Total HTTP requests handled by this instance',
      labelNames: ['method', 'route', 'status'],
      registers: [this.registry],
    });

    this.httpRequestDurationSeconds = new Histogram({
      name: 'raven_http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route', 'status'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });

    this.registerGauges();

    // Email counters live in their own service so the dependency runs one
    // way, MetricsModule imports EmailModule, never the reverse, but
    // they scrape from this registry like everything else. Registered at
    // boot rather than on first send, so a counter at zero is visible
    // (and alertable on) before any email has gone out.
    this.emailMetrics.registerOn(this.registry);
  }

  recordHttpRequest(method: string, route: string, status: number, durationSeconds: number): void {
    const labels = { method, route, status: String(status) };
    this.httpRequestsTotal.inc(labels);
    this.httpRequestDurationSeconds.observe(labels, durationSeconds);
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  async getMetricsText(): Promise<string> {
    return this.registry.metrics();
  }

  private registerGauges(): void {
    const chatGateway = this.chatGateway;
    const signalingGateway = this.signalingGateway;
    const prisma = this.prisma;

    new Gauge({
      name: 'raven_chat_connections_active',
      help: 'Chat WebSocket connections currently held by this instance',
      registers: [this.registry],
      collect() {
        this.set(chatGateway.getMetrics().activeConnections);
      },
    });

    new Gauge({
      name: 'raven_chat_subscribed_rooms',
      help: 'Chat conversations with at least one local socket on this instance',
      registers: [this.registry],
      collect() {
        this.set(chatGateway.getMetrics().subscribedRooms);
      },
    });

    new Gauge({
      name: 'raven_chat_subscribed_channels',
      help: 'Redis pub/sub channels this instance is currently subscribed to for chat fan-out',
      registers: [this.registry],
      collect() {
        this.set(chatGateway.getMetrics().subscribedChannels);
      },
    });

    new Gauge({
      name: 'raven_signaling_connections_active',
      help: 'Signaling WebSocket connections currently held by this instance',
      registers: [this.registry],
      collect() {
        this.set(signalingGateway.getMetrics().activeConnections);
      },
    });

    new Gauge({
      name: 'raven_signaling_rooms_active',
      help: 'Signaling rooms with at least one local participant on this instance',
      registers: [this.registry],
      collect() {
        this.set(signalingGateway.getMetrics().activeRooms);
      },
    });

    new Gauge({
      name: 'raven_signaling_participants_active',
      help: 'Signaling participants currently held by this instance',
      registers: [this.registry],
      collect() {
        this.set(signalingGateway.getMetrics().activeParticipants);
      },
    });

    const sfuLink = this.sfuLink;
    const rtcServers = this.rtcServers;

    new Gauge({
      name: 'raven_rtc_node_links_active',
      help: 'RTC servers this API instance holds a control-plane link to. Per-instance, like the gateway gauges above.',
      registers: [this.registry],
      collect() {
        this.set(sfuLink.getLinkedServers().length);
      },
    });

    new Gauge({
      name: 'raven_rtc_node_link_sessions',
      help: 'Media sessions this API instance owns across its RTC server links',
      registers: [this.registry],
      collect() {
        this.set(
          sfuLink
            .getLinkedServers()
            .reduce((total, server) => total + server.sessions, 0),
        );
      },
    });

    // Fleet gauges, unlike everything above them.
    //
    // These read shared Postgres state, so every instance reports the
    // same numbers: the same exception the webhook queue-depth gauge
    // makes below, and correct for the same reason: fleet capacity is not
    // a per-instance quantity, and summing it across pods would multiply
    // it by the pod count.
    //
    // The RTC servers' own detailed metrics (bitrate, packet counts,
    // layer switches) are exposed by each node's /metrics endpoint and
    // scraped directly. Proxying them through here would put a fan-out to
    // the whole fleet on every scrape of the API.
    new Gauge({
      name: 'raven_rtc_servers',
      help: 'RTC servers registered in the fleet, by health. Fleet-wide, not per-instance.',
      labelNames: ['status'],
      registers: [this.registry],
      async collect() {
        try {
          const fleet = await rtcServers.getFleetMetrics();
          this.set({ status: 'healthy' }, fleet.healthyServers);
          this.set({ status: 'draining' }, fleet.drainingServers);
          this.set({ status: 'unhealthy' }, fleet.unhealthyServers);
        } catch {
          // A scrape must never fail because the database hiccuped;
          // leaving the previous value is better than a 500 on /metrics.
        }
      },
    });

    new Gauge({
      name: 'raven_rtc_rooms_active',
      help: 'Rooms the RTC fleet is serving, as of each node\'s last heartbeat. Fleet-wide, not per-instance.',
      registers: [this.registry],
      async collect() {
        try {
          this.set((await rtcServers.getFleetMetrics()).activeRooms);
        } catch {
          // See above.
        }
      },
    });

    new Gauge({
      name: 'raven_rtc_participants_active',
      help: 'Participants connected across the RTC fleet, as of each node\'s last heartbeat. Fleet-wide, not per-instance.',
      registers: [this.registry],
      async collect() {
        try {
          this.set((await rtcServers.getFleetMetrics()).activeParticipants);
        } catch {
          // See above.
        }
      },
    });

    new Gauge({
      name: 'raven_rtc_room_capacity',
      help: 'Total room capacity advertised by the RTC fleet. With rooms_active, this is the fleet\'s headroom.',
      registers: [this.registry],
      async collect() {
        try {
          this.set((await rtcServers.getFleetMetrics()).capacity);
        } catch {
          // See above.
        }
      },
    });

    new Gauge({
      name: 'raven_webhook_deliveries_pending',
      help: 'Webhook deliveries in PENDING status and due (nextAttemptAt <= now) — a shared Postgres queue depth, not per-instance',
      registers: [this.registry],
      async collect() {
        try {
          const count = await prisma.webhookDelivery.count({
            where: { status: WebhookDeliveryStatus.PENDING, nextAttemptAt: { lte: new Date() } },
          });
          this.set(count);
        } catch {
          // Leave the gauge at its last successfully-observed value rather
          // than fail the whole /metrics scrape over one query.
        }
      },
    });
  }
}
