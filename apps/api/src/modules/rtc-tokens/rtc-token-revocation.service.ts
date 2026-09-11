import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../shared/redis/redis.service';

/**
 * Redis key namespace for RTC token revocation.
 *
 * Namespaced apart from chat's `raven:chat:token:revoked:*` even though the
 * two behave identically. Token ids are minted independently on each side
 * (`rtk_*`/an `rtc_tokens` row id here, `ctk_*` there), so one shared
 * namespace would let a collision revoke the wrong credential, and a
 * per-plane prefix keeps a `KEYS` sweep during an incident answerable about
 * one plane at a time.
 */
export const RtcTokenRedisKeys = {
  revokedToken: (jti: string) => `raven:rtc:token:revoked:${jti}`,
} as const;

/**
 * Revokes RTC tokens ahead of their natural expiry, and answers whether a
 * given token id has been.
 *
 * Deliberately the same design as `ChatTokenService`'s revocation rather
 * than a second mechanism: a tombstone in Redis keyed by the token's `jti`,
 * with a TTL equal to whatever the token had left to live. Two properties
 * come out of that and both matter.
 *
 * **Nothing accumulates.** A tombstone is only useful while the token it
 * kills would otherwise still verify, so it expires with it. Revocation
 * state is therefore bounded by the number of *unexpired* tokens, not by
 * the number ever issued — which is what makes this safe to leave running
 * for years without a reaper.
 *
 * **No raw token is ever stored.** Only the `jti`, which for RTC is the
 * `rtc_tokens` row id: already a public identifier, already in the mint
 * response, already in the logs. A dump of this keyspace tells an attacker
 * which tokens are dead and hands them no credential, whereas a keyspace
 * of raw bearer tokens would be a keyspace of working credentials.
 *
 * ## Why Redis and not the `rtc_tokens` table
 *
 * This is checked on the hot path: every signaling connect and every
 * telemetry POST. A `SELECT` per check would put a database round trip in
 * front of each one, and the answer is "no" essentially always. Redis is
 * already a hard dependency of both planes (presence, room registry,
 * fan-out), so this adds a lookup to infrastructure that is on the critical
 * path regardless, rather than adding a dependency.
 *
 * ## Failure behaviour
 *
 * A Redis outage must not turn every valid token into an auth failure, so
 * an unreachable revocation store means "revocation is delayed", not
 * "nobody can connect". That is the same trade chat already makes, and it
 * is a real trade rather than a free one: during an outage a revoked token
 * keeps working until Redis returns or the token expires on its own. Worth
 * it, because the alternative fails *every* connection to protect the small
 * minority that were revoked — and RTC tokens are short-lived by
 * construction (`rtcToken.defaultTtlSeconds`, 6h ceiling), which bounds the
 * exposure without any action from an operator.
 *
 * Every such failure is logged at error level; it is degraded security and
 * should be visible as that, never silent.
 */
@Injectable()
export class RtcTokenRevocationService {
  private readonly logger = new Logger(RtcTokenRevocationService.name);

  constructor(private readonly redisService: RedisService) {}

  /**
   * Marks `tokenId` revoked until `expiresAt`.
   *
   * A token that has already expired is a no-op rather than an error: it is
   * unusable either way, and making the caller special-case it would just
   * move the check. This is where it diverges very slightly from
   * `ChatTokenService.revoke`, which floors the TTL at one second and
   * writes the tombstone anyway. Skipping the write is equivalent — an
   * expired token is refused for its expiry before revocation is ever
   * consulted — and it keeps `revoke` on an already-dead token from
   * touching Redis at all, which matters because this endpoint is
   * idempotent and therefore retried.
   */
  async revoke(tokenId: string, expiresAt: Date): Promise<void> {
    const ttlSeconds = Math.ceil((expiresAt.getTime() - Date.now()) / 1000);
    if (ttlSeconds <= 0) {
      return;
    }

    await this.redisService.client.set(RtcTokenRedisKeys.revokedToken(tokenId), '1', 'EX', ttlSeconds);
  }

  /**
   * Whether `tokenId` has been revoked.
   *
   * A missing key is the overwhelmingly common case and means "not
   * revoked" — the absence of a tombstone is not the absence of an answer.
   */
  async isRevoked(tokenId: string): Promise<boolean> {
    try {
      return (await this.redisService.client.exists(RtcTokenRedisKeys.revokedToken(tokenId))) === 1;
    } catch (err) {
      this.logger.error(`RTC revocation check unavailable, allowing token: ${(err as Error).message}`);
      return false;
    }
  }
}
