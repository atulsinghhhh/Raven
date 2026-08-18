import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ProjectsModule } from '../projects/projects.module';
import { WebhookDeliveryWorker } from './webhook-delivery.worker';
import { WebhookEventsService } from './webhook-events.service';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

/**
 * Project-scoped webhook delivery. Chat is its only producer today, but
 * nothing here is chat-specific — later phases emit through the same
 * WebhookEventsService rather than standing up a parallel pipeline
 * (spec §31).
 */
@Module({
  imports: [AuditModule, ProjectsModule],
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhookEventsService, WebhookDeliveryWorker],
  exports: [WebhookEventsService, WebhooksService],
})
export class WebhooksModule {}
