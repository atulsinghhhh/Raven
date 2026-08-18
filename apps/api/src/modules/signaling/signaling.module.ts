import { Module } from '@nestjs/common';
import { RtcTokenVerifierService } from './authentication/rtc-token-verifier.service';
import { SignalingGateway } from './gateway/signaling.gateway';
import { MessageRouterService } from './messages/message-router.service';
import { MessageValidatorService } from './messages/message-validator.service';
import { ConnectionRateLimitService } from './rate-limit/connection-rate-limit.service';
import { RoomRegistryService } from './rooms/room-registry.service';

@Module({
  providers: [
    SignalingGateway,
    RtcTokenVerifierService,
    RoomRegistryService,
    MessageValidatorService,
    MessageRouterService,
    ConnectionRateLimitService,
  ],
  exports: [RoomRegistryService, SignalingGateway, RtcTokenVerifierService],
})
export class SignalingModule {}
