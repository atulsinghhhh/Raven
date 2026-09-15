import { Module } from '@nestjs/common';
import { DashboardWsModule } from '../dashboard-ws/dashboard-ws.module';
import { ProjectsModule } from '../projects/projects.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/**
 * Real, persistent dashboard notifications (Phase 5F). Depends on
 * DashboardWsModule the same way WebhooksModule and LiveStreamsModule
 * already do, for the same reason: NotificationsService publishes the
 * `notification.created` nudge through DashboardEventsService after
 * persisting.
 *
 * Producers (WebhookDeliveryWorker, LiveStreamsService) import this
 * module for NotificationsService directly, rather than this module
 * reaching into theirs — same direction every other cross-module
 * dependency in Phase 5B-5F already runs.
 */
@Module({
  imports: [ProjectsModule, DashboardWsModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
