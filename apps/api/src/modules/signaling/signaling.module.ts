import { Module } from '@nestjs/common';
import { RtcTokenSignerModule } from '../rtc-tokens/rtc-token-signer.module';
import { RtcTokenVerifierService } from './authentication/rtc-token-verifier.service';
import { SignalingGateway } from './gateway/signaling.gateway';
import { MessageRouterService } from './messages/message-router.service';
import { MessageValidatorService } from './messages/message-validator.service';
import { ConnectionRateLimitService } from './rate-limit/connection-rate-limit.service';
import { RoomEventsModule } from './rooms/room-events.module';
import { RoomRegistryService } from './rooms/room-registry.service';
import { RoomTrackRegistryService } from './rooms/room-track-registry.service';
import { SfuFrameHandlerService } from './sfu/sfu-frame-handler.service';
import { SfuLinkModule } from './sfu/sfu-link.module';
import { RtcServersModule } from '../rtc-servers/rtc-servers.module';
import { UsageMeteringModule } from '../usage/usage-metering.module';

@Module({
  imports: [RtcTokenSignerModule, RtcServersModule, SfuLinkModule, RoomEventsModule, UsageMeteringModule],
  providers: [
    SignalingGateway,
    RtcTokenVerifierService,
    RoomRegistryService,
    RoomTrackRegistryService,
    SfuFrameHandlerService,
    MessageValidatorService,
    MessageRouterService,
    ConnectionRateLimitService,
  ],
  exports: [
    RoomRegistryService,
    RoomTrackRegistryService,
    SignalingGateway,
    RtcTokenVerifierService,
    // Re-exported as modules rather than providers: Nest can only
    // export providers a module declares itself, and these come from
    // SfuLinkModule and RoomEventsModule.
    SfuLinkModule,
    RoomEventsModule,
  ],
})
export class SignalingModule {}
