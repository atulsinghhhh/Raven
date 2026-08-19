'use client';

import { useEffect, useRef } from 'react';
import type { LocalParticipant, RemoteParticipant, Track } from '@corvidhq/rtc';
import { useLocalParticipant } from './hooks';

/**
 * Optional primitives (Phase 11 spec §18/§19) — every hook above works
 * fine without these; use them for a quick start, not because you have
 * to. Attaches/detaches a track to a real `<video>`/`<audio>` element via
 * `Track.attach()`/`.detach()` — never touches SDP/track internals itself.
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
  /** Rendered below the video/audio elements — defaults to the participant's identity. */
  label?: React.ReactNode;
}

/** A ready-made tile: video (camera or screen share) + audio + an identity label. Fully optional — build your own with `useParticipants()` + `RavenVideo`/`RavenAudio` instead if this doesn't fit. */
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
