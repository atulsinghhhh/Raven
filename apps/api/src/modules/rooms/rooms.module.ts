import { Module } from '@nestjs/common';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { ProjectsModule } from '../projects/projects.module';
import { RtcServersModule } from '../rtc-servers/rtc-servers.module';
import { SfuLinkModule } from '../signaling/sfu/sfu-link.module';
import { DashboardRoomsController } from './dashboard-rooms.controller';
import { SfuRoomStateService } from './sfu-room-state.service';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';

@Module({
  imports: [ApiKeysModule, ProjectsModule, RtcServersModule, SfuLinkModule],
  controllers: [RoomsController, DashboardRoomsController],
  providers: [RoomsService, SfuRoomStateService],
  // SfuRoomStateService is also how Live Streaming derives a live viewer
  // count (SFU participants minus registered hosts): same "ask the SFU,
  // never store live state" pattern Room itself already uses.
  exports: [RoomsService, SfuRoomStateService],
})
export class RoomsModule {}
