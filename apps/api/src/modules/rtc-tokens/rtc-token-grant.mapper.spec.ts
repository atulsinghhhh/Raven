import { TrackSource } from 'livekit-server-sdk';
import { RtcTokenPermissionsDto } from './dto/rtc-token-permissions.dto';
import { fromLiveKitGrant, toLiveKitGrant } from './rtc-token-grant.mapper';

function permissions(overrides: Partial<RtcTokenPermissionsDto>): RtcTokenPermissionsDto {
  return Object.assign(new RtcTokenPermissionsDto(), overrides);
}

describe('toLiveKitGrant', () => {
  it('maps join/subscribe/publishData directly onto the grant', () => {
    const grant = toLiveKitGrant('room-1', permissions({ join: true, subscribe: true, publish: false, publishData: true }));

    expect(grant.room).toBe('room-1');
    expect(grant.roomJoin).toBe(true);
    expect(grant.canSubscribe).toBe(true);
    expect(grant.canPublish).toBe(false);
    expect(grant.canPublishData).toBe(true);
  });

  it('never leaves roomJoin/canSubscribe/canPublish undefined, even when false', () => {
    // LiveKit treats unset canPublish/canSubscribe as "both granted" —
    // guarding against regressing back to that over-permissive default.
    const grant = toLiveKitGrant('room-1', permissions({ join: false, subscribe: false, publish: false }));

    expect(grant.roomJoin).toBe(false);
    expect(grant.canSubscribe).toBe(false);
    expect(grant.canPublish).toBe(false);
  });

  it('does not restrict canPublishSources when publish is false', () => {
    const grant = toLiveKitGrant(
      'room-1',
      permissions({ publish: false, publishAudio: true, publishVideo: true }),
    );

    expect(grant.canPublishSources).toBeUndefined();
  });

  it('restricts to microphone only when publish+publishAudio without publishVideo', () => {
    const grant = toLiveKitGrant(
      'room-1',
      permissions({ publish: true, publishAudio: true, publishVideo: false }),
    );

    expect(grant.canPublishSources).toEqual([TrackSource.MICROPHONE]);
  });

  it('restricts to camera only when publish+publishVideo without publishAudio', () => {
    const grant = toLiveKitGrant(
      'room-1',
      permissions({ publish: true, publishAudio: false, publishVideo: true }),
    );

    expect(grant.canPublishSources).toEqual([TrackSource.CAMERA]);
  });

  it('includes both sources when publish+publishAudio+publishVideo', () => {
    const grant = toLiveKitGrant(
      'room-1',
      permissions({ publish: true, publishAudio: true, publishVideo: true }),
    );

    expect(grant.canPublishSources).toEqual([TrackSource.MICROPHONE, TrackSource.CAMERA]);
  });

  it('leaves canPublishSources unset when publish is true but no sub-flag is set (allow-all default)', () => {
    const grant = toLiveKitGrant(
      'room-1',
      permissions({ publish: true, publishAudio: false, publishVideo: false }),
    );

    expect(grant.canPublishSources).toBeUndefined();
  });
});

describe('fromLiveKitGrant', () => {
  it('is the exact inverse of toLiveKitGrant for a fully-open grant', () => {
    const original = permissions({
      join: true,
      subscribe: true,
      publish: true,
      publishAudio: true,
      publishVideo: true,
      publishData: true,
    });

    const roundTripped = fromLiveKitGrant(toLiveKitGrant('room-1', original));
    expect(roundTripped).toEqual(original);
  });

  it('is the exact inverse of toLiveKitGrant for a subscribe-only grant', () => {
    const original = permissions({
      join: true,
      subscribe: true,
      publish: false,
      publishAudio: false,
      publishVideo: false,
      publishData: false,
    });

    const roundTripped = fromLiveKitGrant(toLiveKitGrant('room-1', original));
    expect(roundTripped).toEqual(original);
  });

  it('is the exact inverse of toLiveKitGrant for an audio-only publish grant', () => {
    const original = permissions({
      join: true,
      subscribe: true,
      publish: true,
      publishAudio: true,
      publishVideo: false,
      publishData: false,
    });

    const roundTripped = fromLiveKitGrant(toLiveKitGrant('room-1', original));
    expect(roundTripped).toEqual(original);
  });

  it('treats a missing grant field as false, never as granted', () => {
    const permissions = fromLiveKitGrant({});
    expect(permissions).toEqual({
      join: false,
      subscribe: false,
      publish: false,
      publishAudio: false,
      publishVideo: false,
      publishData: false,
    });
  });
});
