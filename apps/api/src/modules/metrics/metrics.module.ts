import { Module } from '@nestjs/common';
import { MetricsMiddleware } from '../../shared/middleware/metrics.middleware';
import { ChatModule } from '../chat/chat.module';
import { SignalingModule } from '../signaling/signaling.module';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

@Module({
  imports: [ChatModule, SignalingModule],
  controllers: [MetricsController],
  providers: [MetricsService, MetricsMiddleware],
  exports: [MetricsService, MetricsMiddleware],
})
export class MetricsModule {}
