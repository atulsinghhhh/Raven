import { Module } from '@nestjs/common';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { ProjectsModule } from '../projects/projects.module';
import { RoomsModule } from '../rooms/rooms.module';
import { DashboardRtcTokensController } from './dashboard-rtc-tokens.controller';
import { RtcTokensController } from './rtc-tokens.controller';
import { RtcTokensService } from './rtc-tokens.service';

@Module({
  imports: [ApiKeysModule, ProjectsModule, RoomsModule],
  controllers: [RtcTokensController, DashboardRtcTokensController],
  providers: [RtcTokensService],
})
export class RtcTokensModule {}
