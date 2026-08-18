import { TrackSource, VideoGrant } from 'livekit-server-sdk';
import { RtcTokenPermissionsDto } from './dto/rtc-token-permissions.dto';

/**
 * Translates Raven's own permission vocabulary (join/publish/subscribe/
 * publishAudio/publishVideo/publishData) into a LiveKit VideoGrant.
 *
 * This indirection is deliberate: it's what lets docs/architecture/
 * sfu-comparison.md's documented fallback (swapping LiveKit for mediasoup
 * later) happen without changing the public RTC Token API contract.
 */
export function toLiveKitGrant(roomName: string, permissions: RtcTokenPermissionsDto): VideoGrant {
  const grant: VideoGrant = {
    room: roomName,
    // Always set explicitly: LiveKit treats *both* canPublish and
    // canSubscribe as granted if neither is set, which would silently
    // over-grant relative to what the caller asked for.
    roomJoin: permissions.join ?? false,
    canSubscribe: permissions.subscribe ?? false,
    canPublish: permissions.publish ?? false,
    canPublishData: permissions.publishData ?? false,
  };

  if (grant.canPublish) {
    const sources: TrackSource[] = [];
    if (permissions.publishAudio) sources.push(TrackSource.MICROPHONE);
    if (permissions.publishVideo) sources.push(TrackSource.CAMERA);

    // Only restrict to a subset when the caller asked for one. If publish
    // is granted but neither sub-flag was set, canPublishSources stays
    // unset and LiveKit's default (all sources) applies.
    if (sources.length > 0) {
      grant.canPublishSources = sources;
    }
  }

  return grant;
}

/**
 * The inverse of toLiveKitGrant — used by the signaling layer (Phase 3)
 * to recover Raven's permission vocabulary from a verified LiveKit JWT's
 * claims, so authorization decisions (e.g. "does this participant have
 * join?") stay expressed in our own vocabulary rather than leaking
 * LiveKit's grant shape into the signaling gateway.
 */
export function fromLiveKitGrant(grant: VideoGrant): RtcTokenPermissionsDto {
  const permissions = new RtcTokenPermissionsDto();
  permissions.join = grant.roomJoin ?? false;
  permissions.subscribe = grant.canSubscribe ?? false;
  permissions.publish = grant.canPublish ?? false;
  permissions.publishData = grant.canPublishData ?? false;

  const sources = grant.canPublishSources ?? [];
  // No explicit sources with publish=true means "all sources" (see
  // toLiveKitGrant) — treat that as both audio and video allowed.
  const allSourcesAllowed = permissions.publish && sources.length === 0;
  permissions.publishAudio = allSourcesAllowed || sources.includes(TrackSource.MICROPHONE);
  permissions.publishVideo = allSourcesAllowed || sources.includes(TrackSource.CAMERA);

  return permissions;
}
