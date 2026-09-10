import { Module } from '@nestjs/common';
import { RtcTokenRevocationService } from './rtc-token-revocation.service';
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
 *
 * `RtcTokenRevocationService` ships alongside it for the same reason and
 * along the same seam: minting revokes, verifying checks, and both sides
 * have to agree on one Redis key namespace. It needs no import of its own
 * because `RedisModule` is `@Global`.
 */
@Module({
  providers: [RtcTokenSignerService, RtcTokenRevocationService],
  exports: [RtcTokenSignerService, RtcTokenRevocationService],
})
export class RtcTokenSignerModule {}
