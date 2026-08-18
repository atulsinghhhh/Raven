import { Module } from '@nestjs/common';
import { SignalingModule } from '../signaling/signaling.module';
import { HealthController } from './health.controller';

@Module({
  imports: [SignalingModule],
  controllers: [HealthController],
})
export class HealthModule {}
