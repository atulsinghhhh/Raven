import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TokenVerifier } from 'livekit-server-sdk';
import { fromLiveKitGrant } from '../../rtc-tokens/rtc-token-grant.mapper';
import { RtcTokenPermissionsDto } from '../../rtc-tokens/dto/rtc-token-permissions.dto';
import { SignalingError } from '../signaling-error';
import { SignalingErrorCode } from '../signaling.constants';

export interface VerifiedRtcToken {
  participantId: string;
  projectId: string;
  roomId: string;
  roomName: string;
  permissions: RtcTokenPermissionsDto;
  expiresAt: Date;
}

/**
 * Verifies the same LiveKit-format JWT minted by Phase 2's RTC Token
 * endpoint (docs/control-plane.md#rtc-tokens) — no separate signaling
 * token format. `ravenProjectId`/`ravenRoomId` are custom attributes
 * added specifically so the signaling layer can bind a connection to
 * exactly one project/room without a database round trip on every
 * connect (see rtc-tokens.service.ts). The signed token is the sole
 * source of authorization — nothing the client asserts independently
 * (e.g. a room ID query param) is trusted over what's in the token.
 */
@Injectable()
export class RtcTokenVerifierService {
  private readonly logger = new Logger(RtcTokenVerifierService.name);
  private readonly verifier: TokenVerifier;

  constructor(private readonly configService: ConfigService) {
    this.verifier = new TokenVerifier(
      this.configService.get<string>('livekit.apiKey')!,
      this.configService.get<string>('livekit.apiSecret')!,
    );
  }

  async verify(rawToken: string): Promise<VerifiedRtcToken> {
    if (!rawToken || typeof rawToken !== 'string') {
      throw new SignalingError(SignalingErrorCode.INVALID_TOKEN, 'Missing RTC token');
    }

    let claims;
    try {
      claims = await this.verifier.verify(rawToken);
    } catch (err) {
      // Never log the token itself, and never forward jose's internal
      // error message (may echo back parts of the malformed input).
      const code = this.classifyVerificationError(err);
      this.logger.warn(`RTC token rejected: ${code}`);
      throw new SignalingError(
        code,
        code === SignalingErrorCode.TOKEN_EXPIRED
          ? 'RTC token has expired'
          : 'RTC token is invalid or malformed',
      );
    }

    const participantId = claims.sub;
    const roomName = claims.video?.room;
    const projectId = claims.attributes?.ravenProjectId;
    const roomId = claims.attributes?.ravenRoomId;

    if (!participantId || !roomName || !projectId || !roomId) {
      throw new SignalingError(
        SignalingErrorCode.INVALID_TOKEN,
        'RTC token is missing required claims',
      );
    }

    return {
      participantId,
      projectId,
      roomId,
      roomName,
      permissions: fromLiveKitGrant(claims.video ?? {}),
      expiresAt: new Date((claims.exp ?? 0) * 1000),
    };
  }

  private classifyVerificationError(err: unknown): SignalingErrorCode {
    const code = (err as { code?: string })?.code;
    if (code === 'ERR_JWT_EXPIRED') {
      return SignalingErrorCode.TOKEN_EXPIRED;
    }
    return SignalingErrorCode.INVALID_TOKEN;
  }
}
