import { Module } from '@nestjs/common';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { ChatModule } from '../chat/chat.module';
import { ProjectsModule } from '../projects/projects.module';
import { RoomsModule } from '../rooms/rooms.module';
import { RtcTokensModule } from '../rtc-tokens/rtc-tokens.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { DashboardLiveStreamsController } from './dashboard-live-streams.controller';
import { LiveStreamsController } from './live-streams.controller';
import { LiveStreamsService } from './live-streams.service';

/**
 * Raven Live Streaming. Deliberately owns no media or messaging
 * infrastructure of its own — every import here is the module whose
 * existing service actually does the work (RoomsModule/RtcTokensModule for
 * the RTC side, ChatModule for the chat side, WebhooksModule for events).
 * This module is the lifecycle/role bookkeeping layered on top, not a
 * third real-time system alongside RTC and Chat.
 */
@Module({
  imports: [ApiKeysModule, ProjectsModule, RoomsModule, RtcTokensModule, ChatModule, WebhooksModule],
  controllers: [LiveStreamsController, DashboardLiveStreamsController],
  providers: [LiveStreamsService],
  exports: [LiveStreamsService],
})
export class LiveStreamsModule {}
