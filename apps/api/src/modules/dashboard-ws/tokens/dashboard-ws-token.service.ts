import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { generateId } from '../../../shared/utils/crypto.util';
import { RedisService } from '../../../shared/redis/redis.service';
import { DashboardWsError } from '../dashboard-ws-error';
import { DashboardWsErrorCode, DashboardWsRedisKeys, DASHBOARD_WS_PATH } from '../dashboard-ws.constants';

/**
 * What a minted dashboard WS token carries: everything the gateway needs
 * to authorize the connection without a DB round trip.
 */
export interface DashboardWsTokenClaims {
  /** Token id. The handle you revoke it by. */
  jti: string;
  /** Subject: the developer's own user identity string. */
  sub: string;
  /** Livqeno project id — the *only* source of project scope. Never re-read from anything the client sends. */
  pid: string;
  iat: number;
  exp: number;
  /** Fixed audience so a dashboard session JWT or a chat/RTC token can never be replayed as a dashboard WS token. */
  aud: 'raven-dashboard';
  iss: 'raven';
}

export interface IssuedDashboardWsToken {
  token: string;
  tokenId: string;
  userId: string;
  projectId: string;
  expiresAt: Date;
  /** Where the browser should point its WebSocket. Derived from the API's own public URL, so there's one address to configure instead of two. */
  wsUrl: string;
}

/**
 * Mints and verifies the short-lived credential a browser uses to reach
 * DashboardWsGateway (Phase 5A §8: the frontend must never decide project
 * scope, only a signed backend claim can).
 *
 * Hand-rolled HS256 on purpose, same reasoning as ChatTokenService: this
 * has nothing to do with the media or messaging planes, and reusing either
 * of their tokens here would mean one leaked credential grants dashboard
 * access too.
 *
 * The signing key is DASHBOARD_WS_TOKEN_SECRET, separate from JWT_SECRET
 * (the dashboard session key itself), CHAT_TOKEN_SECRET and
 * RTC_TOKEN_SECRET. None of the four can mint each other's tokens, and the
 * `aud` claim means none of them verifies as another even if a secret got
 * shared by mistake.
 */
@Injectable()
export class DashboardWsTokenService {
  private readonly logger = new Logger(DashboardWsTokenService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Mints a token for `userId` scoped to `projectId`.
   *
   * Callers must have already authorized the caller for this project (see
   * DashboardWsTokensController, which calls ProjectsService.authorize()
   * first) — this method signs whatever project id it is given and does
   * not re-check membership itself.
   */
  issue(input: { projectId: string; userId: string }): IssuedDashboardWsToken {
    const ttlSeconds = this.configService.get<number>('dashboardWs.tokenTtlSeconds')!;
    const issuedAt = Math.floor(Date.now() / 1000);
    const claims: DashboardWsTokenClaims = {
      jti: generateId('dwt'),
      sub: input.userId,
      pid: input.projectId,
      iat: issuedAt,
      exp: issuedAt + ttlSeconds,
      aud: 'raven-dashboard',
      iss: 'raven',
    };

    return {
      token: this.sign(claims),
      tokenId: claims.jti,
      userId: claims.sub,
      projectId: claims.pid,
      expiresAt: new Date(claims.exp * 1000),
      wsUrl: this.wsUrl(),
    };
  }

  /**
   * Verifies signature, audience and expiry, then checks the revocation
   * list. Every rejection path throws a DashboardWsError with a specific
   * code, same reasoning as ChatTokenService.verify: a client holding an
   * expired token should be told to refresh it, not told "unauthorized"
   * and left to work it out.
   */
  async verify(rawToken: string): Promise<DashboardWsTokenClaims> {
    const claims = this.decodeAndVerifySignature(rawToken);

    if (claims.aud !== 'raven-dashboard' || claims.iss !== 'raven') {
      // A dashboard session JWT, a chat token, or an RTC token lands here.
      throw new DashboardWsError(DashboardWsErrorCode.INVALID_TOKEN, 'This token was not issued for the dashboard realtime transport');
    }
    if (claims.exp * 1000 <= Date.now()) {
      throw new DashboardWsError(DashboardWsErrorCode.TOKEN_EXPIRED, 'Dashboard WS token has expired — mint a new one');
    }
    if (await this.isRevoked(claims.jti)) {
      throw new DashboardWsError(DashboardWsErrorCode.TOKEN_REVOKED, 'This dashboard WS token has been revoked');
    }

    return claims;
  }

  /**
   * Revokes a token ahead of its natural expiry. The tombstone only has to
   * outlive the token, so the TTL is whatever the token had left —
   * revocation state never accumulates in Redis. Same design as
   * ChatTokenService.revoke.
   */
  async revoke(tokenId: string, expiresAt: Date): Promise<void> {
    const ttlSeconds = Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 1000));
    await this.redisService.client.set(DashboardWsRedisKeys.revokedToken(tokenId), '1', 'EX', ttlSeconds);
  }

  private async isRevoked(tokenId: string): Promise<boolean> {
    try {
      return (await this.redisService.client.exists(DashboardWsRedisKeys.revokedToken(tokenId))) === 1;
    } catch (err) {
      // Redis being down mustn't turn every valid token into an auth
      // failure. Same fail-open posture as chat/RTC token revocation.
      this.logger.error(`revocation check unavailable, allowing token: ${(err as Error).message}`);
      return false;
    }
  }

  private sign(claims: DashboardWsTokenClaims): string {
    const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = base64url(JSON.stringify(claims));
    const signature = this.hmac(`${header}.${payload}`);
    return `${header}.${payload}.${signature}`;
  }

  private decodeAndVerifySignature(rawToken: string): DashboardWsTokenClaims {
    if (!rawToken || typeof rawToken !== 'string') {
      throw new DashboardWsError(DashboardWsErrorCode.INVALID_TOKEN, 'Missing dashboard WS token');
    }

    const parts = rawToken.split('.');
    if (parts.length !== 3) {
      throw new DashboardWsError(DashboardWsErrorCode.INVALID_TOKEN, 'Dashboard WS token is malformed');
    }

    const [header, payload, signature] = parts;
    const expected = this.hmac(`${header}.${payload}`);

    // Constant-time compare. A plain !== leaks signature bytes through
    // timing to anybody willing to make enough attempts.
    const provided = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (provided.length !== expectedBuffer.length || !timingSafeEqual(provided, expectedBuffer)) {
      throw new DashboardWsError(DashboardWsErrorCode.INVALID_TOKEN, 'Dashboard WS token signature is invalid');
    }

    try {
      return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as DashboardWsTokenClaims;
    } catch {
      // Never echo the malformed input back. It's attacker-controlled.
      throw new DashboardWsError(DashboardWsErrorCode.INVALID_TOKEN, 'Dashboard WS token payload could not be decoded');
    }
  }

  private hmac(input: string): string {
    const secret = this.configService.get<string>('dashboardWs.tokenSecret')!;
    return createHmac('sha256', secret).update(input).digest('base64url');
  }

  private wsUrl(): string {
    const publicUrl = this.configService.get<string>('publicUrl')!;
    const wsUrl = publicUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
    return `${wsUrl.replace(/\/$/, '')}${DASHBOARD_WS_PATH}`;
  }
}

function base64url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}
