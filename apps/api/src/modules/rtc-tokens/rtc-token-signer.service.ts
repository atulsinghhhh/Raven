import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { generateId } from '../../shared/utils/crypto.util';
import { Environment, isEnvironment } from '../../shared/environment/environment.constants';
import { RtcPermissions, RtcTokenClaims, RtcTokenError } from './rtc-token.claims';

export interface SignRtcTokenInput {
  /**
   * Token id to sign as `jti`. Pass the persisted `rtc_tokens` row id so
   * the credential and its record share one identifier — that's what makes
   * a token revocable and makes an RTC log line traceable back to the mint
   * that produced it. Generated if omitted, for callers that mint without
   * persisting.
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
 * Mints and verifies Raven's own RTC credential.
 *
 * Replaces `livekit-server-sdk`'s `AccessToken`/`TokenVerifier`. Raven now
 * owns the token format end to end, which is what lets the SFU behind it be
 * swapped without touching the public token API — the whole point of the
 * migration (see docs/architecture/native-rtc-migration-map.md).
 *
 * HS256, hand-rolled, mirroring `ChatTokenService` rather than pulling in a
 * JWT library: the format is small and fixed, the verification rules are
 * few, and the two services should be readable side by side since they
 * make the same security decisions (own secret, fixed `aud`, constant-time
 * signature compare, no error detail echoed back to the client).
 *
 * Signed with RTC_TOKEN_SECRET, distinct from JWT_SECRET (dashboard
 * sessions) and CHAT_TOKEN_SECRET (chat). None of the three can mint each
 * other's tokens: different secrets, and different `aud` even if a secret
 * were ever shared by accident.
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
   * Verifies signature, audience/issuer, expiry, and claim completeness.
   *
   * Order matters: the signature is checked before anything in the payload
   * is read, so no unverified attacker-controlled value ever reaches a
   * decision. `TOKEN_EXPIRED` is distinguished from `INVALID_TOKEN`
   * because a client whose token merely aged out should be told to refresh
   * (spec §21), not left guessing — but only *after* the signature proves
   * the expiry claim is ours to trust.
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

    // Constant-time compare — a plain !== leaks signature bytes through
    // timing to anyone willing to make enough attempts.
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
      // Never echo the malformed input back — it is attacker-controlled,
      // even though the signature checked out (a valid signature over
      // garbage means our own secret leaked, which is worth logging
      // loudly and still not reflecting).
      throw new RtcTokenError('INVALID_TOKEN', 'RTC token payload could not be decoded');
    }

    const claims = this.assertClaims(decoded);

    if (claims.aud !== 'raven-rtc' || claims.iss !== 'raven') {
      // A chat token or a dashboard session JWT would land here — if it
      // somehow shared our secret.
      throw new RtcTokenError('INVALID_TOKEN', 'This token was not issued for Raven RTC');
    }
    if (claims.exp * 1000 <= Date.now()) {
      throw new RtcTokenError('TOKEN_EXPIRED', 'RTC token has expired — mint a new one');
    }

    return claims;
  }

  /**
   * Rejects a structurally incomplete token outright instead of letting a
   * missing claim read as a falsy default downstream. A token without
   * `perms` must not be treated as a token granting nothing — it must be
   * treated as not a token at all, because the difference between those
   * two is the difference between a confusing bug report and a silent
   * authorization hole in whichever direction the defaults happen to fall.
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
