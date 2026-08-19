'use client';

import type { LiveStream, LiveStreamRole } from '@corvidhq/client';
import { useCamera, useMicrophone } from '../hooks';
import { useRavenLiveStreamContext, type RavenLiveStreamStatus } from './live-context';

/**
 * Live Streaming hooks for `@corvidhq/react`.
 *
 * There is deliberately no `useLiveStreamParticipants()` or
 * `useLiveStreamChat()` here — a stream's participants and chat are a
 * `@corvidhq/rtc` roster and a `@corvidhq/chat` conversation like any
 * other, so `useParticipants()`, `useMessages()`, `useReactions()`, and
 * every other existing `@corvidhq/react` hook already work inside a
 * `<RavenLiveStream>`. Adding parallel names for the same data would be
 * the "separate chat/RTC implementation for streaming" the spec says not
 * to build.
 */

export interface UseLiveStreamResult {
  status: RavenLiveStreamStatus;
  streamId: string;
  role: LiveStreamRole;
  isHost: boolean;
  stream?: LiveStream;
  error?: unknown;
  leave(): Promise<void>;
  react(emoji: string): Promise<void>;
}

/** The full picture: connection status, role, and the two actions every stream needs. */
export function useLiveStream(): UseLiveStreamResult {
  return useRavenLiveStreamContext();
}

export function useLiveStreamRole(): { role: LiveStreamRole; isHost: boolean } {
  const { role, isHost } = useRavenLiveStreamContext();
  return { role, isHost };
}

/** The underlying `LiveStream`, once joined — for anything the hooks don't cover. */
export function useLiveStreamClient(): LiveStream | undefined {
  return useRavenLiveStreamContext().stream;
}

export interface UseLiveStreamHostResult extends UseLiveStreamResult {
  camera: ReturnType<typeof useCamera>;
  microphone: ReturnType<typeof useMicrophone>;
}

/**
 * The host/co-host experience: everything `useLiveStream()` has, plus
 * camera/microphone control. Throws if called for a VIEWER-role stream —
 * a viewer's RTC token has no publish grant, so offering camera/mic
 * controls here would draw a button that can only ever fail.
 */
export function useLiveStreamHost(): UseLiveStreamHostResult {
  const stream = useLiveStream();
  const camera = useCamera();
  const microphone = useMicrophone();

  if (!stream.isHost) {
    throw new Error('useLiveStreamHost() was called for a VIEWER-role stream — use useLiveStreamViewer() instead.');
  }

  return { ...stream, camera, microphone };
}

/**
 * The viewer experience: everything `useLiveStream()` has. Throws if
 * called for a HOST/CO_HOST-role stream, symmetrically with
 * `useLiveStreamHost()` — pick the hook that matches the role your
 * backend minted, rather than branching on `isHost` yourself.
 */
export function useLiveStreamViewer(): UseLiveStreamResult {
  const stream = useLiveStream();

  if (stream.isHost) {
    throw new Error('useLiveStreamViewer() was called for a HOST/CO_HOST-role stream — use useLiveStreamHost() instead.');
  }

  return stream;
}
