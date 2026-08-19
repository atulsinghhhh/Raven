import { Module } from '@nestjs/common';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { ProjectsModule } from '../projects/projects.module';
import { DashboardRoomsController } from './dashboard-rooms.controller';
import { LiveKitRoomService } from './livekit-room.service';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';

@Module({
  imports: [ApiKeysModule, ProjectsModule],
  controllers: [RoomsController, DashboardRoomsController],
  providers: [RoomsService, LiveKitRoomService],
  // LiveKitRoomService is also how Live Streaming derives a live viewer
  // count (SFU participants minus registered hosts) — same "poll the SFU,
  // never store live state" pattern Room itself already uses.
  exports: [RoomsService, LiveKitRoomService],
})
export class RoomsModule {}
