import { Module } from '@nestjs/common';
import { RtcServersModule } from '../rtc-servers/rtc-servers.module';
import { SignalingModule } from '../signaling/signaling.module';
import { HealthController } from './health.controller';

@Module({
  imports: [SignalingModule, RtcServersModule],
  controllers: [HealthController],
})
export class HealthModule {}
