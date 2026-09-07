import { Module } from '@nestjs/common';
import { RtcTokenSignerModule } from '../rtc-tokens/rtc-token-signer.module';
import { RtcTokenVerifierService } from './authentication/rtc-token-verifier.service';
import { SignalingGateway } from './gateway/signaling.gateway';
import { MessageRouterService } from './messages/message-router.service';
import { MessageValidatorService } from './messages/message-validator.service';
import { ConnectionRateLimitService } from './rate-limit/connection-rate-limit.service';
import { RoomEventsService } from './rooms/room-events.service';
import { RoomRegistryService } from './rooms/room-registry.service';
import { RoomTrackRegistryService } from './rooms/room-track-registry.service';
import { SfuFrameHandlerService } from './sfu/sfu-frame-handler.service';
import { SfuLinkModule } from './sfu/sfu-link.module';
import { RtcServersModule } from '../rtc-servers/rtc-servers.module';

@Module({
  imports: [RtcTokenSignerModule, RtcServersModule, SfuLinkModule],
  providers: [
    SignalingGateway,
    RtcTokenVerifierService,
    RoomRegistryService,
    RoomTrackRegistryService,
    RoomEventsService,
    SfuFrameHandlerService,
    MessageValidatorService,
    MessageRouterService,
    ConnectionRateLimitService,
  ],
  exports: [
    RoomRegistryService,
    RoomTrackRegistryService,
    RoomEventsService,
    SignalingGateway,
    RtcTokenVerifierService,
    // Re-exported as a module rather than a provider: Nest can only
    // export providers a module declares itself, and this one comes from
    // SfuLinkModule.
    SfuLinkModule,
  ],
})
export class SignalingModule {}
