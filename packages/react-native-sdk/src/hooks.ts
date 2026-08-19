import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ConnectionState,
  LocalParticipant,
  RemoteParticipant,
  Room,
  RTCError,
} from '@corvidhq/rtc';
import type { Raven } from './raven';
import type { RavenLiveStream } from './live-stream';

/**
 * Hooks for React Native.
 *
 * These mirror `@corvidhq/react`'s hooks in name and meaning, so the same
 * component code reads the same way on both platforms. They are *not*
 * re-exported from that package: `@corvidhq/react` is built around a
 * `<RavenRoom>` provider that owns the client and joins on mount, which
 * suits the web's "one page, one call" model. On mobile the `Raven`
 * instance usually outlives any single screen — it's held by a navigator
 * or a store — so these take the instance directly instead of pulling it
 * from context.
 *
 * Everything below is a subscription to events the SDK already emits.
 * Nothing polls (spec §19).
 */

/** Live connection state for a room. `'disconnected'` when there is no room. */
export function useConnectionState(room: Room | undefined): ConnectionState {
  const [state, setState] = useState<ConnectionState>(room?.connectionState ?? 'disconnected');

  useEffect(() => {
    if (!room) {
      setState('disconnected');
      return undefined;
    }

    // Read once on attach as well as subscribing: the room may already
    // have connected before this component mounted, and waiting for the
    // next transition would leave the UI showing a stale state forever.
    setState(room.connectionState);

    const onChange = (next: ConnectionState) => setState(next);
    room.on('connectionStateChanged', onChange);
    // Block body, not a concise one: @corvidhq/rtc's `off()` is chainable and
    // returns the room, which React would mistake for a cleanup function.
    return () => {
      room.off('connectionStateChanged', onChange);
    };
  }, [room]);

  return state;
}

/**
 * Everyone in the room — local participant first, then remotes.
 *
 * Returns a new array whenever the roster or anyone's tracks change,
 * which is what makes a `.map()` over it re-render correctly.
 */
export function useParticipants(room: Room | undefined): (LocalParticipant | RemoteParticipant)[] {
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!room) {
      return undefined;
    }

    const bump = () => setRevision((value) => value + 1);

    room.on('participantJoined', bump);
    room.on('participantLeft', bump);
    room.on('trackSubscribed', bump);
    room.on('trackUnsubscribed', bump);
    room.on('trackMuted', bump);
    room.on('trackUnmuted', bump);
    room.on('localTrackPublished', bump);
    room.on('localTrackUnpublished', bump);

    return () => {
      room.off('participantJoined', bump);
      room.off('participantLeft', bump);
      room.off('trackSubscribed', bump);
      room.off('trackUnsubscribed', bump);
      room.off('trackMuted', bump);
      room.off('trackUnmuted', bump);
      room.off('localTrackPublished', bump);
      room.off('localTrackUnpublished', bump);
    };
  }, [room]);

  return useMemo(() => {
    if (!room) return [];
    return [room.localParticipant, ...room.remoteParticipants];
    // Participants are mutated in place, so `revision` — not the objects —
    // is what signals that a fresh array is needed.
  }, [room, revision]);
}

export function useRemoteParticipants(room: Room | undefined): RemoteParticipant[] {
  const all = useParticipants(room);
  return useMemo(() => all.slice(1) as RemoteParticipant[], [all]);
}

export interface MediaToggle {
  enabled: boolean;
  /** True while the enable/disable call is in flight — use it to disable the button. */
  busy: boolean;
  enable(): Promise<void>;
  disable(): Promise<void>;
  toggle(): Promise<void>;
  /** The last failure, most usefully a `RavenPermissionError`. */
  error?: RTCError;
}

/**
 * Camera on/off, with the state a button actually needs.
 *
 * `busy` matters more on mobile than on web: acquiring a camera can take
 * a noticeable moment on a phone, and without it a user double-taps and
 * ends up toggling twice.
 */
export function useCamera(room: Room | undefined): MediaToggle {
  return useMediaToggle(room, 'camera');
}

export function useMicrophone(room: Room | undefined): MediaToggle {
  return useMediaToggle(room, 'microphone');
}

function useMediaToggle(room: Room | undefined, kind: 'camera' | 'microphone'): MediaToggle {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<RTCError>();
  // Guards against a state update landing after unmount, which React
  // warns about and which is easy to hit when a user leaves mid-toggle.
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!room) {
      setEnabled(false);
      return undefined;
    }

    const sync = () => {
      const track = room.localParticipant.tracks.find((candidate) => candidate.kind === kind);
      setEnabled(Boolean(track) && !track?.isMuted);
    };

    sync();
    room.on('localTrackPublished', sync);
    room.on('localTrackUnpublished', sync);

    return () => {
      room.off('localTrackPublished', sync);
      room.off('localTrackUnpublished', sync);
    };
  }, [room, kind]);

  const run = useCallback(
    async (action: () => Promise<unknown>, next: boolean) => {
      if (!room) return;
      setBusy(true);
      setError(undefined);
      try {
        await action();
        if (mounted.current) setEnabled(next);
      } catch (err) {
        if (mounted.current) setError(err as RTCError);
        throw err;
      } finally {
        if (mounted.current) setBusy(false);
      }
    },
    [room],
  );

  const enable = useCallback(
    () => run(() => (kind === 'camera' ? room!.enableCamera() : room!.enableMicrophone()), true),
    [run, room, kind],
  );

  const disable = useCallback(
    () => run(() => (kind === 'camera' ? room!.disableCamera() : room!.disableMicrophone()), false),
    [run, room, kind],
  );

  const toggle = useCallback(() => (enabled ? disable() : enable()), [enabled, enable, disable]);

  return { enabled, busy, enable, disable, toggle, error };
}

/** The most recent error the room emitted, for a banner or a toast. */
export function useRavenError(room: Room | undefined): RTCError | undefined {
  const [error, setError] = useState<RTCError>();

  useEffect(() => {
    if (!room) {
      return undefined;
    }
    const onError = (next: RTCError) => setError(next);
    room.on('error', onError);
    return () => {
      room.off('error', onError);
    };
  }, [room]);

  return error;
}

/**
 * Joins on mount and leaves on unmount.
 *
 * The unmount cleanup is the point. On mobile a screen can disappear
 * because the user swiped back, and a call that keeps running behind a
 * dismissed screen is both a bug and a battery drain (spec §19).
 */
export function useRoom(
  raven: Raven | undefined,
  roomId: string | undefined,
  options: { autoJoin?: boolean } = {},
): { room?: Room; joining: boolean; error?: RTCError } {
  const [room, setRoom] = useState<Room>();
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<RTCError>();

  useEffect(() => {
    if (!raven || !roomId || options.autoJoin === false) {
      return undefined;
    }

    let cancelled = false;
    setJoining(true);
    setError(undefined);

    raven
      .join(roomId)
      .then((joined) => {
        // The screen went away while we were connecting. Leaving
        // immediately is the only correct move — otherwise the call
        // survives its own UI.
        if (cancelled) {
          void raven.leave();
          return;
        }
        setRoom(joined);
      })
      .catch((err) => {
        if (!cancelled) setError(err as RTCError);
      })
      .finally(() => {
        if (!cancelled) setJoining(false);
      });

    return () => {
      cancelled = true;
      setRoom(undefined);
      void raven.leave();
    };
  }, [raven, roomId, options.autoJoin]);

  return { room, joining, error };
}

/**
 * Joins a live stream on mount and leaves on unmount — the Live Streaming
 * equivalent of `useRoom()`. Returns the same `Room` `useParticipants()`,
 * `useCamera()`, `useMicrophone()`, and `useRavenError()` already accept,
 * so nothing new is needed to use them against a stream.
 */
export function useLiveStream(
  stream: RavenLiveStream | undefined,
  options: { autoJoin?: boolean } = {},
): { room?: Room; joining: boolean; error?: RTCError } {
  const [room, setRoom] = useState<Room>();
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<RTCError>();

  useEffect(() => {
    if (!stream || options.autoJoin === false) {
      return undefined;
    }

    let cancelled = false;
    setJoining(true);
    setError(undefined);

    stream
      .join()
      .then((joined) => {
        if (cancelled) {
          void stream.leave();
          return;
        }
        setRoom(joined);
      })
      .catch((err) => {
        if (!cancelled) setError(err as RTCError);
      })
      .finally(() => {
        if (!cancelled) setJoining(false);
      });

    return () => {
      cancelled = true;
      setRoom(undefined);
      void stream.leave();
    };
  }, [stream, options.autoJoin]);

  return { room, joining, error };
}
