import { Environment } from '../../shared/environment/environment.constants';
import { RtcTokenPermissionsDto } from './dto/rtc-token-permissions.dto';

/**
 * Raven's own RTC permission vocabulary, resolved to explicit booleans.
 *
 * Same field names as `RtcTokenPermissionsDto`, on purpose. The public API,
 * the signed claim, the signaling layer's authorization checks and the SFU
 * all speak one vocabulary. There's no foreign grant shape to translate
 * into and back out of any more, which is exactly what the old
 * `rtc-token-grant.mapper.ts` existed to do.
 *
 * The one difference from the DTO: every field here is required. "Unset"
 * isn't a state any verifier should have to interpret. See
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
 * What a minted RTC token carries.
 *
 * The field names are short because this rides in a URL query parameter on
 * every WebSocket connect, and a token that doesn't fit comfortably in a
 * URL is a token that generates bug reports.
 *
 * Everything the signaling layer needs to authorize a connection is signed,
 * so a connect costs no database round trip. None of it is secret; the
 * client holding it can read the lot, exactly like the LiveKit token this
 * replaced. What matters is that the client can't *modify* any of it
 * (spec §38).
 */
export interface RtcTokenClaims {
  /** Token id. The handle you revoke it by, and the correlation id in RTC logs. */
  jti: string;
  /** Subject: the participant identity the developer's backend chose. */
  sub: string;
  /** Raven project id. */
  pid: string;
  /**
   * Environment. Signed instead of sent, for the same reason `sub` is: a
   * browser holding a development token mustn't be able to reach production
   * by editing a request field.
   */
  env: Environment;
  /** Room id (the `rooms.id` primary key). */
  rid: string;
  /**
   * Room name. Carried next to `rid` because the SDK accepts either when
   * checking a token matches the room being joined, and because logs and the
   * dashboard get read by humans, who know rooms by name.
   */
  rnm: string;
  perms: RtcPermissions;
  iat: number;
  exp: number;
  /**
   * A fixed audience, so a chat token or a dashboard session JWT can never
   * be replayed as an RTC token, or the other way round. Each is signed with
   * its own secret too; `aud` is the second lock, not the only one.
   */
  aud: 'raven-rtc';
  iss: 'raven';
}

export type RtcTokenErrorCode = 'INVALID_TOKEN' | 'TOKEN_EXPIRED';

/**
 * Thrown by `RtcTokenSignerService.verify`.
 *
 * Carries a coarse code, not a detailed reason, on purpose.
 * Callers need to tell "refresh your token" from "this token isn't valid",
 * and nothing finer than that should ever reach a client: finer detail is
 * an oracle for whoever's probing.
 *
 * The signaling layer maps this onto `SignalingErrorCode`, the HTTP layer
 * onto a 401. Neither imports the other's error type.
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
 * that actually gets signed.
 *
 * Two behaviours carry over on purpose from the LiveKit grant mapper this
 * replaced, because both are observable through the public API:
 *
 * 1. **Anything unset is denied, never granted.** LiveKit's own default was
 *    the opposite; unset `canPublish`/`canSubscribe` meant "both granted",
 *    and the old mapper set every field explicitly just to avoid inheriting
 *    that. Resolving to explicit booleans here means there's no permissive
 *    default left to inherit in the first place.
 *
 * 2. **`publish: true` with neither `publishAudio` nor `publishVideo` set
 *    means both are allowed.** "Let this participant publish, I don't much
 *    care what" is the common case, and the sub-flags exist to *narrow* it.
 *    The old mapper said this by leaving `canPublishSources` unset. A claim
 *    has no "unset" state, so the widening happens here at mint time, where
 *    somebody can reason about it, instead of being re-derived by every
 *    verifier.
 *
 * A sub-flag without `publish` grants nothing, which matches the old
 * mapper's "does not restrict canPublishSources when publish is false"
 * behaviour. The sub-flags were never independently sufficient.
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
 * Tolerant of a missing or partial `perms` object, so a token minted by an
 * older build resolves to something safe rather than throwing. And "safe"
 * means denied, per rule 1 above.
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
