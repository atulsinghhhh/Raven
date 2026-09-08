import { Module } from '@nestjs/common';
import { RtcTokenSignerService } from './rtc-token-signer.service';

/**
 * The signer on its own, with no other dependencies.
 *
 * It exists as a separate module because both sides of the RTC token's
 * life need it: `RtcTokensModule` to mint, `SignalingModule` to verify;
 * and importing the full `RtcTokensModule` into signaling would be a cycle
 * (`RtcTokensModule` → `RoomsModule`, and signaling is imported by
 * observability which rooms reaches into). Providing the signer twice
 * instead would work, since it's stateless, but two providers for one
 * secret is the kind of thing that quietly becomes two *different*
 * secrets after a refactor.
 */
@Module({
  providers: [RtcTokenSignerService],
  exports: [RtcTokenSignerService],
})
export class RtcTokenSignerModule {}
