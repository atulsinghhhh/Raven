'use client';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { LocalParticipant, LocalTrack, RemoteParticipant, RTCError, Room, RTCClient } from '@corvidhq/rtc';
import { useRavenStore } from './context';
import type { RavenConnectionState, RavenSnapshot } from './store';

/** The full snapshot, plus `join`/`leave` — use the narrower hooks below where you can, to avoid rerendering on unrelated changes. */
export interface UseRavenResult extends RavenSnapshot {
  join(roomId: string): Promise<void>;
  leave(): Promise<void>;
}

export function useRaven(): UseRavenResult {
  const store = useRavenStore();
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return useMemo(
    () => ({ ...snapshot, join: store.join.bind(store), leave: store.leave.bind(store) }),
    [snapshot, store],
  );
}

export function useRoom(): Room | undefined {
  const store = useRavenStore();
  return useSyncExternalStore(store.subscribe, () => store.getSnapshot().room);
}

/** @internal exposed mainly so `examples/` and advanced integrations can reach the raw client before a room exists. */
export function useRavenClient(): RTCClient | undefined {
  const store = useRavenStore();
  return useSyncExternalStore(store.subscribe, () => store.getSnapshot().client);
}

export function useConnectionState(): RavenConnectionState {
  const store = useRavenStore();
  return useSyncExternalStore(store.subscribe, () => store.getSnapshot().connectionState);
}

export function useLocalParticipant() {
  const store = useRavenStore();
  return useSyncExternalStore(store.subscribe, () => store.getSnapshot().localParticipant);
}

export function useRemoteParticipants() {
  const store = useRavenStore();
  return useSyncExternalStore(store.subscribe, () => store.getSnapshot().remoteParticipants);
}

/** Local participant (if joined) followed by every remote participant — the full roster in one call. */
export function useParticipants(): (LocalParticipant | RemoteParticipant)[] {
  const local = useLocalParticipant();
  const remote = useRemoteParticipants();
  return useMemo(() => (local ? [local, ...remote] : [...remote]), [local, remote]);
}

export function useRavenError(): RTCError | undefined {
  const store = useRavenStore();
  return useSyncExternalStore(store.subscribe, () => store.getSnapshot().error);
}

interface LocalMediaControl {
  enabled: boolean;
  track?: LocalTrack;
  enable(): Promise<void>;
  disable(): Promise<void>;
  error?: RTCError;
}

function useLocalMediaTrack(kind: 'camera' | 'microphone'): LocalMediaControl {
  const room = useRoom();
  const [track, setTrack] = useState<LocalTrack | undefined>(() =>
    room?.localParticipant.tracks.find((t) => t.kind === kind),
  );
  const [error, setError] = useState<RTCError>();

  useEffect(() => {
    if (!room) return undefined;
    const sync = () => setTrack(room.localParticipant.tracks.find((t) => t.kind === kind));
    sync();
    room.on('localTrackPublished', sync);
    room.on('localTrackUnpublished', sync);
    return () => {
      room.off('localTrackPublished', sync);
      room.off('localTrackUnpublished', sync);
    };
  }, [room, kind]);

  const enable = useCallback(async () => {
    if (!room) return;
    try {
      await (kind === 'camera' ? room.enableCamera() : room.enableMicrophone());
      setError(undefined);
    } catch (err) {
      setError(err as RTCError);
      throw err;
    }
  }, [room, kind]);

  const disable = useCallback(async () => {
    if (!room) return;
    await (kind === 'camera' ? room.disableCamera() : room.disableMicrophone());
  }, [room, kind]);

  return { enabled: Boolean(track), track, enable, disable, error };
}

export function useCamera(): LocalMediaControl {
  return useLocalMediaTrack('camera');
}

export function useMicrophone(): LocalMediaControl {
  return useLocalMediaTrack('microphone');
}
