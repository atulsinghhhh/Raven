import { Module } from '@nestjs/common';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { ChatModule } from '../chat/chat.module';
import { ProjectsModule } from '../projects/projects.module';
import { RoomsModule } from '../rooms/rooms.module';
import { RtcTokensModule } from '../rtc-tokens/rtc-tokens.module';
import { UsageMeteringModule } from '../usage/usage-metering.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { DashboardLiveStreamsController } from './dashboard-live-streams.controller';
import { EgressControlService } from './egress/egress-control.service';
import { EgressInternalController } from './egress/egress-internal.controller';
import { EgressWorkerGuard } from './egress/egress-worker.guard';
import { LiveStreamsController } from './live-streams.controller';
import { LiveStreamsService } from './live-streams.service';

/**
 * Livqeno Live Streaming. Deliberately owns no media or messaging
 * infrastructure of its own: every import here is the module whose
 * existing service actually does the work (RoomsModule/RtcTokensModule for
 * the RTC side, ChatModule for the chat side, WebhooksModule for events).
 * This module is the lifecycle/role bookkeeping layered on top, not a
 * third real-time system alongside RTC and Chat.
 */
@Module({
  imports: [
    ApiKeysModule,
    ProjectsModule,
    RoomsModule,
    RtcTokensModule,
    ChatModule,
    WebhooksModule,
    UsageMeteringModule,
  ],
  controllers: [LiveStreamsController, DashboardLiveStreamsController, EgressInternalController],
  providers: [LiveStreamsService, EgressControlService, EgressWorkerGuard],
  exports: [LiveStreamsService],
})
export class LiveStreamsModule {}
