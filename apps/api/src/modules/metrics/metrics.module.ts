import { Module } from '@nestjs/common';
import { MetricsMiddleware } from '../../shared/middleware/metrics.middleware';
import { ChatModule } from '../chat/chat.module';
import { DashboardWsModule } from '../dashboard-ws/dashboard-ws.module';
import { HealthModule } from '../health/health.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RtcServersModule } from '../rtc-servers/rtc-servers.module';
import { SfuLinkModule } from '../signaling/sfu/sfu-link.module';
import { SignalingModule } from '../signaling/signaling.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { MetricsAuthGuard } from './metrics-auth.guard';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

// WebhooksModule/NotificationsModule are imported here for their metrics
// sources only (WebhookDeliveryWorker, NotificationsService) — pulled
// from via collect(), same as every gateway above. This direction only:
// ChatModule already imports WebhooksModule, so the reverse edge
// (WebhooksModule importing MetricsModule) would cycle, which is exactly
// why delivery/upsert counters are exposed as in-memory state to pull
// from rather than pushed to MetricsService the way MetricsMiddleware
// pushes HTTP metrics (that push is same-module, no cross-module edge).
@Module({
  imports: [
    ChatModule,
    SignalingModule,
    RtcServersModule,
    SfuLinkModule,
    DashboardWsModule,
    WebhooksModule,
    NotificationsModule,
    HealthModule,
  ],
  controllers: [MetricsController],
  providers: [MetricsService, MetricsMiddleware, MetricsAuthGuard],
  exports: [MetricsService, MetricsMiddleware],
})
export class MetricsModule {}
