import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { ChatMemberRole } from '../../../generated/prisma/client';
import { generateId } from '../../../shared/utils/crypto.util';
import { RedisService } from '../../../shared/redis/redis.service';
import { ChatError } from '../chat-error';
import { ChatErrorCode, RedisKeys } from '../chat.constants';
import { Environment } from '../../../shared/environment/environment.constants';
import { ChatScope, isChatScope, narrowScopes, scopesForRole } from '../chat-permissions';

/** What a minted chat token carries: everything a gateway needs to authorize without a DB round trip. */
export interface ChatTokenClaims {
  /** Token id. The handle you revoke it by. */
  jti: string;
  /** Subject: the developer's own user identity string. */
  sub: string;
  /** Raven project id. */
  pid: string;
  /**
   * Environment. Signed, not sent, because a browser holding a
   * development token mustn't be able to reach production data by editing a
   * request field. Same reason `sub` is a claim.
   *
   * Optional on the type so tokens minted before environments existed still
   * verify. They resolve to development at the guard.
   */
  env?: Environment;
  /** Conversations this token may touch. Empty means every conversation the user belongs to. */
  cvs: string[];
  scopes: ChatScope[];
  iat: number;
  exp: number;
  /** Fixed audience so an RTC/session JWT can never be replayed as a chat token. */
  aud: 'raven-chat';
  iss: 'raven';
}

export interface IssuedChatToken {
  token: string;
  tokenId: string;
  userId: string;
  projectId: string;
  environment: Environment;
  scopes: ChatScope[];
  conversations: string[];
  expiresAt: Date;
  /** Where the browser should point `@ravenkash/chat`. The SDK never hardcodes a host. */
  chatUrl: string;
  /** REST base for history/attachment calls made with this same token. */
  apiUrl: string;
}

/**
 * Mints and verifies the short-lived credential a browser uses to reach the
 * chat gateway (spec §10).
 *
 * Hand-rolled HS256 on purpose, rather than reaching for the RTC token
 * machinery. Chat has nothing to do with the media plane, and reusing an
 * RTC token here would mean one leaked credential grants both media and
 * messaging.
 *
 * The signing key is CHAT_TOKEN_SECRET, separate from JWT_SECRET (the
 * dashboard session key) and from RTC_TOKEN_SECRET. None of the three can
 * mint each other's tokens, and the `aud` claim means none of them verifies
 * as another even if a secret got shared by mistake.
 */
@Injectable()
export class ChatTokenService {
  private readonly logger = new Logger(ChatTokenService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * @param role the member's role in the conversation(s); scopes come from it
   * @param requestedScopes optional narrowing. Can only ever remove permissions, never add
   */
  issue(input: {
    projectId: string;
    environment: Environment;
    userId: string;
    conversations: string[];
    role: ChatMemberRole;
    requestedScopes?: string[];
    ttlSeconds?: number;
  }): IssuedChatToken {
    const maxTtl = this.configService.get<number>('chat.tokenMaxTtlSeconds')!;
    const defaultTtl = this.configService.get<number>('chat.tokenDefaultTtlSeconds')!;
    const ttlSeconds = Math.min(input.ttlSeconds ?? defaultTtl, maxTtl);

    const requested = input.requestedScopes?.filter(isChatScope);
    const scopes = narrowScopes(scopesForRole(input.role), requested);

    const issuedAt = Math.floor(Date.now() / 1000);
    const claims: ChatTokenClaims = {
      jti: generateId('ctk'),
      sub: input.userId,
      pid: input.projectId,
      env: input.environment,
      cvs: input.conversations,
      scopes,
      iat: issuedAt,
      exp: issuedAt + ttlSeconds,
      aud: 'raven-chat',
      iss: 'raven',
    };

    return {
      token: this.sign(claims),
      tokenId: claims.jti,
      userId: claims.sub,
      projectId: claims.pid,
      environment: input.environment,
      scopes,
      conversations: claims.cvs,
      expiresAt: new Date(claims.exp * 1000),
      chatUrl: this.chatUrl(),
      apiUrl: this.configService.get<string>('publicUrl')!,
    };
  }

  /**
   * Verifies signature, audience and expiry, then checks the revocation
   * list.
   *
   * Every rejection path throws a ChatError with a specific code. A client
   * holding an expired token should be told to refresh it, not told
   * "unauthorized" and left to work it out.
   */
  async verify(rawToken: string): Promise<ChatTokenClaims> {
    const claims = this.decodeAndVerifySignature(rawToken);

    if (claims.aud !== 'raven-chat' || claims.iss !== 'raven') {
      // A dashboard session JWT or an RTC token lands here.
      throw new ChatError(ChatErrorCode.INVALID_TOKEN, 'This token was not issued for Raven Chat');
    }
    if (claims.exp * 1000 <= Date.now()) {
      throw new ChatError(ChatErrorCode.TOKEN_EXPIRED, 'Chat token has expired — mint a new one');
    }
    if (await this.isRevoked(claims.jti)) {
      throw new ChatError(ChatErrorCode.TOKEN_REVOKED, 'This chat token has been revoked');
    }

    return claims;
  }

  /**
   * Revokes a token ahead of its natural expiry.
   *
   * The tombstone only has to outlive the token, so the TTL is whatever the
   * token had left. Revocation state therefore never accumulates in Redis.
   */
  async revoke(tokenId: string, expiresAt: Date): Promise<void> {
    const ttlSeconds = Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 1000));
    await this.redisService.client.set(RedisKeys.revokedToken(tokenId), '1', 'EX', ttlSeconds);
  }

  private async isRevoked(tokenId: string): Promise<boolean> {
    try {
      return (await this.redisService.client.exists(RedisKeys.revokedToken(tokenId))) === 1;
    } catch (err) {
      // Redis being down mustn't turn every valid token into an auth
      // failure. Chat degrades to "revocation is delayed", not "nobody can
      // connect". Logged so it's visible, never swallowed.
      this.logger.error(`revocation check unavailable, allowing token: ${(err as Error).message}`);
      return false;
    }
  }

  private sign(claims: ChatTokenClaims): string {
    const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = base64url(JSON.stringify(claims));
    const signature = this.hmac(`${header}.${payload}`);
    return `${header}.${payload}.${signature}`;
  }

  private decodeAndVerifySignature(rawToken: string): ChatTokenClaims {
    if (!rawToken || typeof rawToken !== 'string') {
      throw new ChatError(ChatErrorCode.INVALID_TOKEN, 'Missing chat token');
    }

    const parts = rawToken.split('.');
    if (parts.length !== 3) {
      throw new ChatError(ChatErrorCode.INVALID_TOKEN, 'Chat token is malformed');
    }

    const [header, payload, signature] = parts;
    const expected = this.hmac(`${header}.${payload}`);

    // Constant-time compare. A plain !== leaks signature bytes through
    // timing to anybody willing to make enough attempts.
    const provided = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (provided.length !== expectedBuffer.length || !timingSafeEqual(provided, expectedBuffer)) {
      throw new ChatError(ChatErrorCode.INVALID_TOKEN, 'Chat token signature is invalid');
    }

    try {
      return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as ChatTokenClaims;
    } catch {
      // Never echo the malformed input back. It's attacker-controlled.
      throw new ChatError(ChatErrorCode.INVALID_TOKEN, 'Chat token payload could not be decoded');
    }
  }

  private hmac(input: string): string {
    const secret = this.configService.get<string>('chat.tokenSecret')!;
    return createHmac('sha256', secret).update(input).digest('base64url');
  }

  /** Derives the wss:// URL from the API's own public URL, so there's one address to configure instead of two. */
  private chatUrl(): string {
    const publicUrl = this.configService.get<string>('publicUrl')!;
    const wsUrl = publicUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
    return `${wsUrl.replace(/\/$/, '')}/v1/chat/ws`;
  }
}

function base64url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}
