import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { generateId } from '../../shared/utils/crypto.util';
import { Environment, isEnvironment } from '../../shared/environment/environment.constants';
import { RtcPermissions, RtcTokenClaims, RtcTokenError } from './rtc-token.claims';

export interface SignRtcTokenInput {
  /**
   * Token id to sign as `jti`. Pass the persisted `rtc_tokens` row id, so
   * the credential and its record share one identifier. That's what makes a
   * token revocable, and what makes an RTC log line traceable back to the
   * mint that produced it. Generated if you leave it out, for callers that
   * mint without persisting.
   */
  tokenId?: string;
  projectId: string;
  environment: Environment;
  roomId: string;
  roomName: string;
  participantIdentity: string;
  permissions: RtcPermissions;
  ttlSeconds: number;
}

export interface SignedRtcToken {
  token: string;
  tokenId: string;
  issuedAt: Date;
  expiresAt: Date;
  claims: RtcTokenClaims;
}

/**
 * Mints and verifies Livqeno's own RTC credential.
 *
 * This replaced `livekit-server-sdk`'s `AccessToken` and `TokenVerifier`.
 * Livqeno owns the token format end to end now, and that's what lets the SFU
 * behind it be swapped without touching the public token API. Which was
 * rather the point of the migration; see
 * docs/architecture/native-rtc-migration-map.md.
 *
 * HS256, hand-rolled, mirroring `ChatTokenService` instead of pulling in a
 * JWT library. The format is small and fixed, there are only a handful of
 * verification rules, and the two services want to be readable side by
 * side, since they make the same security decisions: own secret, fixed
 * `aud`, constant-time signature compare, no error detail echoed back to
 * the client.
 *
 * Signed with RTC_TOKEN_SECRET, separate from JWT_SECRET (dashboard
 * sessions) and CHAT_TOKEN_SECRET (chat). None of the three can mint each
 * other's tokens: different secrets, and different `aud` even if a secret
 * somehow got shared by accident.
 */
@Injectable()
export class RtcTokenSignerService {
  private readonly logger = new Logger(RtcTokenSignerService.name);

  constructor(private readonly configService: ConfigService) {}

  sign(input: SignRtcTokenInput): SignedRtcToken {
    const issuedAt = Math.floor(Date.now() / 1000);
    const claims: RtcTokenClaims = {
      jti: input.tokenId ?? generateId('rtk'),
      sub: input.participantIdentity,
      pid: input.projectId,
      env: input.environment,
      rid: input.roomId,
      rnm: input.roomName,
      perms: input.permissions,
      iat: issuedAt,
      exp: issuedAt + input.ttlSeconds,
      aud: 'raven-rtc',
      iss: 'raven',
    };

    const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = base64url(JSON.stringify(claims));
    const signature = this.hmac(`${header}.${payload}`);

    return {
      token: `${header}.${payload}.${signature}`,
      tokenId: claims.jti,
      issuedAt: new Date(claims.iat * 1000),
      expiresAt: new Date(claims.exp * 1000),
      claims,
    };
  }

  /**
   * Verifies signature, audience and issuer, expiry, and claim
   * completeness.
   *
   * The order matters. We check the signature before reading a single thing
   * out of the payload, so no unverified attacker-controlled value ever
   * reaches a decision.
   *
   * `TOKEN_EXPIRED` is kept apart from `INVALID_TOKEN` because a client
   * whose token merely aged out should be told to refresh (spec §21) rather
   * than left guessing. But only *after* the signature has proved the expiry
   * claim is ours to trust in the first place.
   */
  verify(rawToken: string): RtcTokenClaims {
    if (!rawToken || typeof rawToken !== 'string') {
      throw new RtcTokenError('INVALID_TOKEN', 'Missing RTC token');
    }

    const parts = rawToken.split('.');
    if (parts.length !== 3) {
      throw new RtcTokenError('INVALID_TOKEN', 'RTC token is malformed');
    }

    const [header, payload, signature] = parts;
    const expected = this.hmac(`${header}.${payload}`);

    // Constant-time compare. A plain !== leaks signature bytes through
    // timing to anybody willing to make enough attempts.
    const provided = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (provided.length !== expectedBuffer.length || !timingSafeEqual(provided, expectedBuffer)) {
      this.logger.warn('RTC token rejected: signature mismatch');
      throw new RtcTokenError('INVALID_TOKEN', 'RTC token signature is invalid');
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      // Never echo the malformed input back. It's attacker-controlled even
      // though the signature checked out, and a valid signature over
      // garbage means our own secret leaked. Worth logging loudly, and
      // still worth not reflecting.
      throw new RtcTokenError('INVALID_TOKEN', 'RTC token payload could not be decoded');
    }

    const claims = this.assertClaims(decoded);

    if (claims.aud !== 'raven-rtc' || claims.iss !== 'raven') {
      // A chat token or a dashboard session JWT lands here, if it somehow
      // shared our secret.
      throw new RtcTokenError('INVALID_TOKEN', 'This token was not issued for Livqeno RTC');
    }
    if (claims.exp * 1000 <= Date.now()) {
      throw new RtcTokenError('TOKEN_EXPIRED', 'RTC token has expired — mint a new one');
    }

    return claims;
  }

  /**
   * Rejects a structurally incomplete token outright, rather than let a
   * missing claim read as a falsy default further downstream.
   *
   * A token without `perms` must not be treated as a token that grants
   * nothing. It has to be treated as not a token at all. The difference
   * between those two is the difference between a confusing bug report and
   * a silent authorization hole, depending on which way the defaults happen
   * to fall.
   */
  private assertClaims(decoded: unknown): RtcTokenClaims {
    if (!decoded || typeof decoded !== 'object') {
      throw new RtcTokenError('INVALID_TOKEN', 'RTC token payload is not an object');
    }

    const candidate = decoded as Record<string, unknown>;
    const required = ['jti', 'sub', 'pid', 'rid', 'rnm'] as const;
    for (const field of required) {
      if (typeof candidate[field] !== 'string' || (candidate[field] as string).length === 0) {
        throw new RtcTokenError('INVALID_TOKEN', 'RTC token is missing required claims');
      }
    }
    if (typeof candidate.iat !== 'number' || typeof candidate.exp !== 'number') {
      throw new RtcTokenError('INVALID_TOKEN', 'RTC token is missing required claims');
    }
    if (!isEnvironment(candidate.env)) {
      throw new RtcTokenError('INVALID_TOKEN', 'RTC token carries an unknown environment');
    }
    if (!candidate.perms || typeof candidate.perms !== 'object') {
      throw new RtcTokenError('INVALID_TOKEN', 'RTC token is missing permissions');
    }

    const perms = candidate.perms as Record<string, unknown>;
    const permissionFields: (keyof RtcPermissions)[] = [
      'join',
      'subscribe',
      'publish',
      'publishAudio',
      'publishVideo',
      'publishData',
    ];
    for (const field of permissionFields) {
      if (typeof perms[field] !== 'boolean') {
        throw new RtcTokenError('INVALID_TOKEN', 'RTC token permissions are malformed');
      }
    }

    return candidate as unknown as RtcTokenClaims;
  }

  private hmac(input: string): string {
    const secret = this.configService.get<string>('rtcToken.secret')!;
    return createHmac('sha256', secret).update(input).digest('base64url');
  }
}

function base64url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}
