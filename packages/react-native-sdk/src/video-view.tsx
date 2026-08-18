import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { RTCView } from '@livekit/react-native-webrtc';
import type { LocalParticipant, RemoteParticipant, Room, Track, TrackKind } from '@raven/rtc';

export interface RavenVideoViewProps {
  /** Whose video to show. Local or remote — the component doesn't care which. */
  participant?: LocalParticipant | RemoteParticipant;
  /**
   * The room, if you want the view to update by itself as tracks are
   * published, unpublished, muted or resubscribed. Without it the view
   * renders whatever the participant holds at mount and won't follow
   * changes — which is fine for a static thumbnail and wrong for a call.
   */
  room?: Room;
  /** `'camera'` (default) or `'screenShare'`. */
  source?: Extract<TrackKind, 'camera' | 'screenShare'>;
  style?: ViewStyle;
  /** `'cover'` (default) crops to fill; `'contain'` letterboxes. */
  objectFit?: 'cover' | 'contain';
  /**
   * Mirrors horizontally. Defaults to true for the local camera, which is
   * what a user expects of their own preview, and false for everyone else.
   */
  mirror?: boolean;
  /** Stacking hint. Use 1 for a local preview floating over remote video. */
  zOrder?: number;
  /** Rendered when there is no video to show — muted, not yet published, or camera off. */
  placeholder?: React.ReactNode;
}

/**
 * Renders a participant's video.
 *
 * This is the one part of the SDK that could not be shared with web.
 * A browser attaches a track to a `<video>` element; React Native has no
 * DOM, and video has to reach a native `SurfaceView` (Android) or
 * `UIView` (iOS). So `RavenVideoView` takes the same `participant` object
 * a web app would hand to `<ParticipantView>` and routes it to the native
 * renderer instead.
 *
 * ```tsx
 * <RavenVideoView participant={remote} room={room} style={{ flex: 1 }} />
 * <RavenVideoView participant={local} room={room} style={styles.pip} zOrder={1} />
 * ```
 *
 * No WebRTC types appear in the props, and none need to appear in your
 * code (spec §2).
 */
export function RavenVideoView({
  participant,
  room,
  source = 'camera',
  style,
  objectFit = 'cover',
  mirror,
  zOrder,
  placeholder,
}: RavenVideoViewProps) {
  // A counter, not the track itself. Track objects are mutated in place
  // by the SDK, so storing one in state and comparing references would
  // miss updates; bumping a version on every relevant room event forces
  // the re-read below to run again.
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!room) {
      return undefined;
    }

    const rerender = () => setRevision((value) => value + 1);

    // Every event that can change what should be on screen. Missing one
    // shows a frozen or blank tile that only fixes itself on the next
    // unrelated render — the classic mobile video bug.
    room.on('trackSubscribed', rerender);
    room.on('trackUnsubscribed', rerender);
    room.on('trackPublished', rerender);
    room.on('trackUnpublished', rerender);
    room.on('trackMuted', rerender);
    room.on('trackUnmuted', rerender);
    room.on('localTrackPublished', rerender);
    room.on('localTrackUnpublished', rerender);
    room.on('participantJoined', rerender);
    room.on('participantLeft', rerender);

    return () => {
      // Unsubscribing on unmount is what stops a scrolled-away tile from
      // holding the participant alive and re-rendering forever (spec §19).
      room.off('trackSubscribed', rerender);
      room.off('trackUnsubscribed', rerender);
      room.off('trackPublished', rerender);
      room.off('trackUnpublished', rerender);
      room.off('trackMuted', rerender);
      room.off('trackUnmuted', rerender);
      room.off('localTrackPublished', rerender);
      room.off('localTrackUnpublished', rerender);
      room.off('participantJoined', rerender);
      room.off('participantLeft', rerender);
    };
  }, [room]);

  const streamUrl = useMemo(() => {
    const track = findVideoTrack(participant, source);
    if (!track || track.isMuted) {
      return undefined;
    }
    return toStreamUrl(track);
    // `revision` is the dependency that matters — see the comment above.
  }, [participant, source, revision]);

  // Identity against the room, not a type check: LocalParticipant and
  // RemoteParticipant are structurally identical, and `instanceof` is
  // unreliable in a monorepo where Metro can resolve two copies of
  // @raven/rtc. Without a room we can't know, so we don't guess.
  const shouldMirror = mirror ?? (source === 'camera' && room?.localParticipant === participant);

  if (!streamUrl) {
    return <View style={[styles.container, style]}>{placeholder ?? null}</View>;
  }

  return (
    <RTCView
      // Keyed by the stream so a participant swapping cameras (or a track
      // being replaced on reconnect) tears down the native view rather
      // than trying to rebind a surface that's already gone.
      key={streamUrl}
      streamURL={streamUrl}
      style={[styles.container, style]}
      objectFit={objectFit}
      mirror={shouldMirror}
      zOrder={zOrder}
    />
  );
}

function findVideoTrack(
  participant: LocalParticipant | RemoteParticipant | undefined,
  source: 'camera' | 'screenShare',
): Track | undefined {
  return participant?.tracks.find((track) => track.kind === source);
}

/**
 * Bridges a Raven track to the native renderer.
 *
 * `track.mediaStream` is public API on `@raven/rtc`, and under React
 * Native it holds an `@livekit/react-native-webrtc` `MediaStream` — which
 * carries a `toURL()` the native view can bind to. Going through the
 * public surface is what keeps `@raven/rtc` unmodified (spec §22); the
 * cast covers the one method React Native adds that the DOM type doesn't
 * declare.
 */
function toStreamUrl(track: Track): string | undefined {
  const stream = track.mediaStream as (MediaStream & { toURL?: () => string }) | undefined;
  return typeof stream?.toURL === 'function' ? stream.toURL() : undefined;
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#000',
    overflow: 'hidden',
  },
});
