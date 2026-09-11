import { Module } from '@nestjs/common';
import { MetricsMiddleware } from '../../shared/middleware/metrics.middleware';
import { ChatModule } from '../chat/chat.module';
import { RtcServersModule } from '../rtc-servers/rtc-servers.module';
import { SfuLinkModule } from '../signaling/sfu/sfu-link.module';
import { SignalingModule } from '../signaling/signaling.module';
import { MetricsAuthGuard } from './metrics-auth.guard';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

@Module({
  imports: [ChatModule, SignalingModule, RtcServersModule, SfuLinkModule],
  controllers: [MetricsController],
  providers: [MetricsService, MetricsMiddleware, MetricsAuthGuard],
  exports: [MetricsService, MetricsMiddleware],
})
export class MetricsModule {}
