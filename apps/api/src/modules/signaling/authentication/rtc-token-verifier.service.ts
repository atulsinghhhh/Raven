import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TokenVerifier } from 'livekit-server-sdk';
import { fromLiveKitGrant } from '../../rtc-tokens/rtc-token-grant.mapper';
import { RtcTokenPermissionsDto } from '../../rtc-tokens/dto/rtc-token-permissions.dto';
import { SignalingError } from '../signaling-error';
import { SignalingErrorCode } from '../signaling.constants';
import { DEFAULT_ENVIRONMENT, Environment, isEnvironment } from '../../../shared/environment/environment.constants';

export interface VerifiedRtcToken {
  participantId: string;
  projectId: string;
  environment: Environment;
  roomId: string;
  roomName: string;
  permissions: RtcTokenPermissionsDto;
  expiresAt: Date;
}

/**
 * Verifies the same LiveKit-format JWT the RTC Token endpoint mints —
 * there's no separate signaling token format. ravenProjectId/ravenRoomId
 * are custom attributes added so the signaling layer can bind a
 * connection to one project/room without a DB round trip on every
 * connect (see rtc-tokens.service.ts). The signed token is the only
 * source of authorization — anything the client asserts on its own (a
 * room ID query param, say) is never trusted over what's in the token.
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
      // Never log the token itself, and never forward jose's raw error
      // message — it can echo back parts of the malformed input.
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
    // Tokens minted before environments existed carry no attribute; they
    // were development traffic, and reporting them as such beats dropping
    // the telemetry entirely.
    const environment = claims.attributes?.ravenEnvironment;

    if (!participantId || !roomName || !projectId || !roomId) {
      throw new SignalingError(
        SignalingErrorCode.INVALID_TOKEN,
        'RTC token is missing required claims',
      );
    }

    return {
      participantId,
      projectId,
      environment: isEnvironment(environment) ? environment : DEFAULT_ENVIRONMENT,
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
