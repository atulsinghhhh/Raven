import { TrackSource, VideoGrant } from 'livekit-server-sdk';
import { RtcTokenPermissionsDto } from './dto/rtc-token-permissions.dto';

/**
 * Translates Raven's permission vocabulary (join/publish/subscribe/
 * publishAudio/publishVideo/publishData) into a LiveKit VideoGrant. The
 * indirection means we could swap LiveKit for another SFU later without
 * touching the public RTC Token API contract.
 */
export function toLiveKitGrant(roomName: string, permissions: RtcTokenPermissionsDto): VideoGrant {
  const grant: VideoGrant = {
    room: roomName,
    // Set explicitly on purpose — LiveKit grants both canPublish and
    // canSubscribe if neither is set, which would silently over-grant.
    roomJoin: permissions.join ?? false,
    canSubscribe: permissions.subscribe ?? false,
    canPublish: permissions.publish ?? false,
    canPublishData: permissions.publishData ?? false,
  };

  if (grant.canPublish) {
    const sources: TrackSource[] = [];
    if (permissions.publishAudio) sources.push(TrackSource.MICROPHONE);
    if (permissions.publishVideo) sources.push(TrackSource.CAMERA);

    // Only restrict to a subset if the caller actually asked for one —
    // otherwise leave canPublishSources unset so LiveKit's default (all
    // sources) applies.
    if (sources.length > 0) {
      grant.canPublishSources = sources;
    }
  }

  return grant;
}

/**
 * Inverse of toLiveKitGrant. The signaling layer uses this to recover our
 * permission vocabulary from a verified LiveKit JWT's claims, so it can
 * ask "does this participant have join?" without leaking LiveKit's grant
 * shape into the gateway.
 */
export function fromLiveKitGrant(grant: VideoGrant): RtcTokenPermissionsDto {
  const permissions = new RtcTokenPermissionsDto();
  permissions.join = grant.roomJoin ?? false;
  permissions.subscribe = grant.canSubscribe ?? false;
  permissions.publish = grant.canPublish ?? false;
  permissions.publishData = grant.canPublishData ?? false;

  const sources = grant.canPublishSources ?? [];
  // publish=true with no explicit sources means "all sources" (see
  // toLiveKitGrant above) — treat that as audio and video both allowed.
  const allSourcesAllowed = permissions.publish && sources.length === 0;
  permissions.publishAudio = allSourcesAllowed || sources.includes(TrackSource.MICROPHONE);
  permissions.publishVideo = allSourcesAllowed || sources.includes(TrackSource.CAMERA);

  return permissions;
}
