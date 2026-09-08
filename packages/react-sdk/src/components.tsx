'use client';

import { useEffect, useRef } from 'react';
import type { LocalParticipant, RemoteParticipant, Track } from '@corvidhq/rtc';
import { useLocalParticipant } from './hooks';

/**
 * Optional primitives (Phase 11 spec §18/§19). Every hook above works
 * perfectly well without them; use these for a quick start, not because
 * you have to.
 *
 * Attaches and detaches a track to a real `<video>` or `<audio>` element
 * through `Track.attach()` and `.detach()`. Never touches SDP or track
 * internals itself.
 */
export interface RavenVideoProps extends Omit<React.VideoHTMLAttributes<HTMLVideoElement>, 'ref'> {
  track?: Track;
}

export function RavenVideo({ track, ...props }: RavenVideoProps) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!track || !element) return undefined;
    track.attach(element);
    return () => {
      track.detach(element);
    };
  }, [track]);

  return <video ref={ref} autoPlay playsInline {...props} />;
}

export interface RavenAudioProps extends Omit<React.AudioHTMLAttributes<HTMLAudioElement>, 'ref'> {
  track?: Track;
}

export function RavenAudio({ track, ...props }: RavenAudioProps) {
  const ref = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!track || !element) return undefined;
    track.attach(element);
    return () => {
      track.detach(element);
    };
  }, [track]);

  return <audio ref={ref} autoPlay {...props} />;
}

export interface ParticipantViewProps {
  participant: LocalParticipant | RemoteParticipant;
  className?: string;
  /** Rendered below the video and audio elements. Defaults to the participant's identity. */
  label?: React.ReactNode;
}

/** A ready-made tile: video (camera or screen share), audio, an identity label. Entirely optional. If it doesn't fit, build your own from `useParticipants()` plus `RavenVideo`/`RavenAudio`. */
export function ParticipantView({ participant, className, label }: ParticipantViewProps) {
  const videoTrack = participant.tracks.find((t) => t.kind === 'camera' || t.kind === 'screenShare');
  const audioTrack = participant.tracks.find((t) => t.kind === 'microphone');

  return (
    <div className={className} data-raven-participant={participant.identity}>
      {videoTrack ? (
        <RavenVideo track={videoTrack} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : null}
      {audioTrack ? <RavenAudio track={audioTrack} /> : null}
      <span data-raven-participant-label>{label ?? participant.identity}</span>
    </div>
  );
}

export function LocalParticipantView({ className, label }: { className?: string; label?: React.ReactNode }) {
  const local = useLocalParticipant();
  if (!local) return null;
  return <ParticipantView participant={local} className={className} label={label} />;
}
