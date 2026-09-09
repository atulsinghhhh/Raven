import { Module } from '@nestjs/common';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { ProjectsModule } from '../projects/projects.module';
import { RoomsModule } from '../rooms/rooms.module';
import { UsageMeteringModule } from '../usage/usage-metering.module';
import { DashboardRtcTokensController } from './dashboard-rtc-tokens.controller';
import { RtcTokenSignerModule } from './rtc-token-signer.module';
import { RtcTokensController } from './rtc-tokens.controller';
import { RtcTokensService } from './rtc-tokens.service';

@Module({
  imports: [ApiKeysModule, ProjectsModule, RoomsModule, RtcTokenSignerModule, UsageMeteringModule],
  controllers: [RtcTokensController, DashboardRtcTokensController],
  providers: [RtcTokensService],
  // Live Streaming mints host/viewer RTC tokens through this same service
  // instead of a second token implementation (spec: "reuse the existing
  // Raven token architecture where possible").
  exports: [RtcTokensService],
})
export class RtcTokensModule {}
