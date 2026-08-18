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
  exports: [RoomsService],
})
export class RoomsModule {}
