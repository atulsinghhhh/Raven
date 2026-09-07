import { Injectable, Logger } from '@nestjs/common';
import { RtcTokenSignerService } from '../../rtc-tokens/rtc-token-signer.service';
import {
  RtcPermissions,
  RtcTokenError,
  toPermissionsDto,
} from '../../rtc-tokens/rtc-token.claims';
import { RtcTokenPermissionsDto } from '../../rtc-tokens/dto/rtc-token-permissions.dto';
import { SignalingError } from '../signaling-error';
import { SignalingErrorCode } from '../signaling.constants';
import { Environment } from '../../../shared/environment/environment.constants';

export interface VerifiedRtcToken {
  /** Token id (`jti`) — also the `rtc_tokens` row id. The correlation key for every RTC log line on this connection. */
  tokenId: string;
  participantId: string;
  projectId: string;
  environment: Environment;
  roomId: string;
  roomName: string;
  permissions: RtcTokenPermissionsDto;
  /** The same grant as `permissions`, in the shape the SFU and authorization checks use. */
  grant: RtcPermissions;
  expiresAt: Date;
}

/**
 * Verifies the same Raven RTC token the token endpoint mints — there's no
 * separate signaling token format.
 *
 * The signed token is the only source of authorization. Anything the client
 * asserts on its own (a room id query param, say) is never trusted over
 * what's in the token (spec §38).
 *
 * This is a thin translation layer on purpose: `RtcTokenSignerService` owns
 * the crypto and the claim rules, and this maps its errors onto the
 * signaling wire vocabulary so the gateway never has to know a token
 * format exists.
 */
@Injectable()
export class RtcTokenVerifierService {
  private readonly logger = new Logger(RtcTokenVerifierService.name);

  constructor(private readonly signer: RtcTokenSignerService) {}

  /**
   * `async` even though verification is synchronous — the gateway awaits
   * this, and keeping the signature async leaves room for a Redis-backed
   * revocation check (as chat already does) without touching every caller.
   */
  async verify(rawToken: string): Promise<VerifiedRtcToken> {
    let claims;
    try {
      claims = this.signer.verify(rawToken);
    } catch (err) {
      if (err instanceof RtcTokenError) {
        // Never log the token itself.
        this.logger.warn(`RTC token rejected: ${err.code}`);
        throw new SignalingError(
          err.code === 'TOKEN_EXPIRED'
            ? SignalingErrorCode.TOKEN_EXPIRED
            : SignalingErrorCode.INVALID_TOKEN,
          err.message,
        );
      }
      this.logger.error(`RTC token verification failed unexpectedly: ${(err as Error).message}`);
      throw new SignalingError(SignalingErrorCode.INVALID_TOKEN, 'RTC token could not be verified');
    }

    return {
      tokenId: claims.jti,
      participantId: claims.sub,
      projectId: claims.pid,
      environment: claims.env,
      roomId: claims.rid,
      roomName: claims.rnm,
      permissions: toPermissionsDto(claims.perms),
      grant: claims.perms,
      expiresAt: new Date(claims.exp * 1000),
    };
  }
}
