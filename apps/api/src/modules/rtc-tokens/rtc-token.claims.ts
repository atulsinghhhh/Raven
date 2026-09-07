import { Environment } from '../../shared/environment/environment.constants';
import { RtcTokenPermissionsDto } from './dto/rtc-token-permissions.dto';

/**
 * Raven's own RTC permission vocabulary, resolved to explicit booleans.
 *
 * Identical field names to `RtcTokenPermissionsDto` on purpose — the
 * public API, the signed claim, the signaling layer's authorization
 * checks, and the SFU all speak one vocabulary. There is no foreign grant
 * shape to translate into and back out of any more, which is what the old
 * `rtc-token-grant.mapper.ts` existed to do.
 *
 * The difference from the DTO is that every field here is required.
 * "Unset" is not a state a verifier should ever have to interpret — see
 * `resolvePermissions`.
 */
export interface RtcPermissions {
  join: boolean;
  subscribe: boolean;
  publish: boolean;
  publishAudio: boolean;
  publishVideo: boolean;
  publishData: boolean;
}

/**
 * What a minted RTC token carries. Short field names because this rides in
 * a URL query parameter on every WebSocket connect, and a token that
 * doesn't fit comfortably in a URL is a token that causes bug reports.
 *
 * Everything the signaling layer needs to authorize a connection is
 * signed, so a connect costs no database round-trip. Nothing here is a
 * secret — it is all readable by the client holding it, exactly like the
 * LiveKit token it replaces. What matters is that none of it is
 * *modifiable* by the client (spec §38).
 */
export interface RtcTokenClaims {
  /** Token id — the handle used to revoke it, and the correlation id in RTC logs. */
  jti: string;
  /** Subject: the participant identity the developer's backend chose. */
  sub: string;
  /** Raven project id. */
  pid: string;
  /**
   * Environment. Signed rather than sent, for the same reason `sub` is:
   * a browser holding a development token must not reach production by
   * editing a request field.
   */
  env: Environment;
  /** Room id (the `rooms.id` primary key). */
  rid: string;
  /**
   * Room name. Carried alongside `rid` because the SDK accepts either when
   * checking that a token matches the room being joined, and because logs
   * and the dashboard are read by humans, who know rooms by name.
   */
  rnm: string;
  perms: RtcPermissions;
  iat: number;
  exp: number;
  /**
   * Fixed audience so a chat token or a dashboard session JWT can never be
   * replayed as an RTC token, and vice versa. Each is signed with its own
   * secret as well — `aud` is the second lock, not the only one.
   */
  aud: 'raven-rtc';
  iss: 'raven';
}

export type RtcTokenErrorCode = 'INVALID_TOKEN' | 'TOKEN_EXPIRED';

/**
 * Thrown by `RtcTokenSignerService.verify`. Deliberately carries a coarse
 * code rather than a detailed reason: callers need to distinguish
 * "refresh your token" from "this token is not valid", and nothing finer
 * than that should reach a client, since finer detail is an oracle for
 * whoever is probing.
 *
 * The signaling layer maps this onto `SignalingErrorCode`; the HTTP layer
 * maps it onto a 401. Neither imports the other's error type.
 */
export class RtcTokenError extends Error {
  constructor(
    readonly code: RtcTokenErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RtcTokenError';
  }
}

/**
 * Normalizes a request's optional permission flags into the explicit set
 * that gets signed.
 *
 * Two behaviours are preserved deliberately from the LiveKit grant mapper
 * this replaces, because both are observable through the public API:
 *
 * 1. **Anything unset is denied, never granted.** LiveKit's own default
 *    was the opposite (unset `canPublish`/`canSubscribe` meant "both
 *    granted"), and the old mapper set every field explicitly to avoid
 *    inheriting that. Resolving to explicit booleans here means there is
 *    no permissive default left to inherit in the first place.
 *
 * 2. **`publish: true` with neither `publishAudio` nor `publishVideo` set
 *    means both are allowed.** "Let this participant publish, I don't care
 *    what" is the common case, and the sub-flags exist to *narrow* it. The
 *    old mapper expressed this by leaving `canPublishSources` unset; since
 *    a claim has no "unset" state, the widening happens here, at mint
 *    time, where it can be reasoned about — rather than being re-derived
 *    by every verifier.
 *
 * A sub-flag without `publish` grants nothing, matching the old mapper's
 * "does not restrict canPublishSources when publish is false" behaviour:
 * the sub-flags were never independently sufficient.
 */
export function resolvePermissions(dto: RtcTokenPermissionsDto | undefined): RtcPermissions {
  const requested = dto ?? new RtcTokenPermissionsDto();

  const publish = requested.publish ?? false;
  const audioRequested = requested.publishAudio ?? false;
  const videoRequested = requested.publishVideo ?? false;
  const allSources = publish && !audioRequested && !videoRequested;

  return {
    join: requested.join ?? false,
    subscribe: requested.subscribe ?? false,
    publish,
    publishAudio: publish && (allSources || audioRequested),
    publishVideo: publish && (allSources || videoRequested),
    publishData: requested.publishData ?? false,
  };
}

/**
 * Recovers the public DTO shape from signed claims, for the API responses
 * and dashboard views that echo back what a token was granted.
 *
 * Tolerant of a missing/partial `perms` object so a token minted by an
 * older build still resolves to something safe rather than throwing —
 * and "safe" means denied, per rule 1 above.
 */
export function toPermissionsDto(perms: Partial<RtcPermissions> | undefined): RtcTokenPermissionsDto {
  const dto = new RtcTokenPermissionsDto();
  dto.join = perms?.join ?? false;
  dto.subscribe = perms?.subscribe ?? false;
  dto.publish = perms?.publish ?? false;
  dto.publishAudio = perms?.publishAudio ?? false;
  dto.publishVideo = perms?.publishVideo ?? false;
  dto.publishData = perms?.publishData ?? false;
  return dto;
}
