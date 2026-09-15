import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DashboardWsModule } from '../dashboard-ws/dashboard-ws.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProjectsModule } from '../projects/projects.module';
import { WebhookDeliveryWorker } from './webhook-delivery.worker';
import { WebhookEventsService } from './webhook-events.service';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

/**
 * Project-scoped webhook delivery. Chat is its only producer today, but
 * nothing here is chat-specific: later phases emit through the same
 * WebhookEventsService rather than standing up a parallel pipeline
 * (spec §31).
 */
@Module({
  imports: [AuditModule, ProjectsModule, DashboardWsModule, NotificationsModule],
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhookEventsService, WebhookDeliveryWorker],
  // WebhookDeliveryWorker exported for MetricsService (Phase 6H) — same
  // reasoning the gateways are exported for: it is now also a metrics
  // source, pulled from rather than pushed to (see MetricsService for why
  // that direction, not the other, keeps this acyclic with ChatModule
  // already importing WebhooksModule).
  exports: [WebhookEventsService, WebhooksService, WebhookDeliveryWorker],
})
export class WebhooksModule {}
