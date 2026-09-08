'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import type { LocalParticipant, LocalTrack, RemoteParticipant, RTCError, Room, RTCClient } from '@corvidhq/rtc';
import { createEffectsPipeline } from '@corvidhq/effects';
import type { EffectsError, EffectsPipeline, FilterConfig, Preset, ColorOpParams, EffectInstance } from '@corvidhq/effects';
import { useRavenStore } from './context';
import type { RavenConnectionState, RavenSnapshot } from './store';

/** The full snapshot plus `join` and `leave`. Use the narrower hooks below where you can, and avoid re-rendering on unrelated changes. */
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

/** @internal Exposed mostly so `examples/` and advanced integrations can reach the raw client before a room exists. */
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

/** Local participant, if joined, then every remote one. The full roster in one call. */
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

export interface UseCameraEffectsResult {
  /** The underlying Raven Effects pipeline. Pass it to `raven.effects.presets.*` or `filters.*` for anything advanced. */
  pipeline: EffectsPipeline;
  effects: readonly EffectInstance[];
  isEnabled: boolean;
  /** True once the pipeline is actively processing the live camera track (false before the camera is enabled). */
  isAttached: boolean;
  error?: EffectsError;
  add(config: FilterConfig): EffectInstance;
  applyPreset(preset: Preset): EffectInstance[];
  remove(effectOrId: EffectInstance | string): void;
  update(effectId: string, params: Partial<ColorOpParams>): void;
  reorder(effectId: string, toIndex: number): void;
  enable(effectId?: string): void;
  disable(effectId?: string): void;
  clear(): void;
}

/**
 * Raven Effects for `@corvidhq/react`.
 *
 * Consumes the same `EffectsPipeline` and `LocalTrack.attachEffects()` from
 * `@corvidhq/effects` and `@corvidhq/rtc`, rather than a separate
 * React-specific engine. Creates one pipeline per hook instance and keeps
 * it attached to whatever camera track `useCamera()` currently reports,
 * through enables, disables and device switches. The pipeline itself is
 * what you hand to `raven.effects.presets` and `filters`.
 */
export function useCameraEffects(): UseCameraEffectsResult {
  const camera = useCamera();
  const pipelineRef = useRef<EffectsPipeline | undefined>(undefined);
  if (!pipelineRef.current) {
    pipelineRef.current = createEffectsPipeline();
  }
  const pipeline = pipelineRef.current;

  const [version, forceRender] = useReducer((c: number) => c + 1, 0);
  const [error, setError] = useState<EffectsError>();

  useEffect(() => {
    const onChange = () => forceRender();
    const onError = (err: EffectsError) => setError(err);
    pipeline.on('effectAdded', onChange);
    pipeline.on('effectRemoved', onChange);
    pipeline.on('effectUpdated', onChange);
    pipeline.on('reordered', onChange);
    pipeline.on('enabled', onChange);
    pipeline.on('disabled', onChange);
    pipeline.on('cleared', onChange);
    pipeline.on('error', onError);
    return () => {
      pipeline.off('effectAdded', onChange);
      pipeline.off('effectRemoved', onChange);
      pipeline.off('effectUpdated', onChange);
      pipeline.off('reordered', onChange);
      pipeline.off('enabled', onChange);
      pipeline.off('disabled', onChange);
      pipeline.off('cleared', onChange);
      pipeline.off('error', onError);
    };
  }, [pipeline]);

  const [isAttached, setIsAttached] = useState(false);
  useEffect(() => {
    const track = camera.track;
    if (!track) {
      setIsAttached(false);
      return undefined;
    }
    let cancelled = false;
    track
      .attachEffects(pipeline)
      .then(() => {
        if (!cancelled) setIsAttached(true);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err as EffectsError);
      });
    return () => {
      cancelled = true;
      setIsAttached(false);
      void track.detachEffects();
    };
  }, [camera.track, pipeline]);

  return useMemo(
    () => ({
      pipeline,
      effects: pipeline.effects,
      isEnabled: pipeline.isEnabled,
      isAttached,
      error,
      add: pipeline.add.bind(pipeline),
      applyPreset: pipeline.applyPreset.bind(pipeline),
      remove: pipeline.remove.bind(pipeline),
      update: pipeline.update.bind(pipeline),
      reorder: pipeline.reorder.bind(pipeline),
      enable: pipeline.enable.bind(pipeline),
      disable: pipeline.disable.bind(pipeline),
      clear: pipeline.clear.bind(pipeline),
    }),
    // `version` is the load-bearing dep. Every pipeline event bumps it via
    // forceRender (add, remove, update, reorder, enable, disable, clear), so
    // this memo recomputes and re-reads pipeline.effects and isEnabled
    // fresh. Those are live getters, not stable snapshots.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pipeline, isAttached, error, version],
  );
}
