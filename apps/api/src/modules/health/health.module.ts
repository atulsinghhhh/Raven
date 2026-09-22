import { Module } from '@nestjs/common';
import { RtcServersModule } from '../rtc-servers/rtc-servers.module';
import { SignalingModule } from '../signaling/signaling.module';
import { HealthController } from './health.controller';
import { TurnHealthService } from './turn-health.service';

@Module({
  imports: [SignalingModule, RtcServersModule],
  controllers: [HealthController],
  providers: [TurnHealthService],
  exports: [TurnHealthService],
})
export class HealthModule {}
