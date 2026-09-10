import { detectCapabilities } from './capabilities';
import { hasDocument } from './dom';
import { EffectsError } from './errors';
import { TypedEventEmitter } from './events';
import type { FilterConfig } from './filters/index';
import { FILTER_DEFINITIONS } from './filters/index';
import type { Preset } from './presets';
import { assertPipelineNotFull, validateParams } from './security';
import type { EffectInstance, ColorOpParams, RavenEffect } from './types';
import type { EffectsEngine, PipelineStats } from './engine/types';
import { selectEngine } from './engine/select-engine';
import type { EngineKind } from './capabilities';

export interface EffectsPipelineEventMap {
  effectAdded: (effect: EffectInstance) => void;
  effectRemoved: (effectId: string) => void;
  effectUpdated: (effect: EffectInstance) => void;
  reordered: (order: string[]) => void;
  enabled: (effectId?: string) => void;
  disabled: (effectId?: string) => void;
  cleared: () => void;
  error: (error: EffectsError) => void;
  stats: (stats: PipelineStats) => void;
}

interface CustomEffectRegistration {
  effect: RavenEffect;
  params: ColorOpParams;
}

let pipelineCounter = 0;
let effectCounter = 0;

/**
 * Raven Effects' pipeline: a reusable, ordered list of video effects you can
 * attach to any Raven camera track. RTC or Live Streaming, doesn't matter;
 * they're the same `LocalTrack`.
 *
 * The pipeline owns *what* to render. An `EffectsEngine` owns *how*, and
 * which one you get (WebGL2, Canvas2D, passthrough) is decided by
 * capability detection.
 */
export class EffectsPipeline extends TypedEventEmitter<EffectsPipelineEventMap> {
  readonly id: string;
  private _isEnabled = true;
  private _effects: EffectInstance[] = [];
  private customRegistrations = new Map<string, CustomEffectRegistration>();
  private engine?: EffectsEngine;
  private videoEl?: HTMLVideoElement;
  private statsTimer?: ReturnType<typeof setInterval>;

  constructor() {
    super();
    this.id = `effects_${++pipelineCounter}`;
  }

  get effects(): readonly EffectInstance[] {
    return this._effects;
  }

  get isEnabled(): boolean {
    return this._isEnabled;
  }

  /** Appends a filter from `raven.effects.filters.*`, or a preset entry, to the pipeline. */
  add(config: FilterConfig): EffectInstance {
    assertPipelineNotFull(this._effects.length);
    const definition = FILTER_DEFINITIONS[config.type];
    if (!definition) {
      throw new EffectsError('RAVEN_EFFECT_UNSUPPORTED', `Unknown filter type "${config.type}".`);
    }
    validateParams(config.params, definition.params);
    const instance: EffectInstance = {
      id: `effect_${++effectCounter}`,
      type: config.type,
      name: config.name,
      enabled: true,
      params: { ...config.params },
      op: definition.op,
    };
    this._effects.push(instance);
    this.engine?.rebuild();
    this.emit('effectAdded', instance);
    return instance;
  }

  /**
   * Registers a trusted, in-process custom effect (Phase 16 §19).
   *
   * Raven Effects never loads an effect from a URL and never executes
   * untrusted code. `effect` has to already be a real object in the host
   * application's own bundle. See security.ts.
   */
  addCustomEffect(effect: RavenEffect, initialParams: ColorOpParams = {}): EffectInstance {
    assertPipelineNotFull(this._effects.length);
    validateParams(initialParams, effect.parameters);
    const merged: ColorOpParams = {};
    for (const [name, spec] of Object.entries(effect.parameters)) {
      merged[name] = initialParams[name] ?? spec.default;
    }
    const op = effect.process(merged);
    const instance: EffectInstance = {
      id: `effect_${++effectCounter}`,
      type: `custom:${effect.id}`,
      name: effect.name,
      enabled: true,
      params: merged,
      op,
    };
    this.customRegistrations.set(instance.id, { effect, params: merged });
    this._effects.push(instance);
    this.engine?.rebuild();
    this.emit('effectAdded', instance);
    return instance;
  }

  /** Adds every filter in a preset, in order. `raven.effects.presets.cinematic()`, say. */
  applyPreset(preset: Preset): EffectInstance[] {
    return preset().map((config) => this.add(config));
  }

  remove(effectOrId: EffectInstance | string): void {
    const id = typeof effectOrId === 'string' ? effectOrId : effectOrId.id;
    const index = this._effects.findIndex((e) => e.id === id);
    if (index === -1) return;
    const registration = this.customRegistrations.get(id);
    if (registration) {
      void registration.effect.destroy();
      this.customRegistrations.delete(id);
    }
    this._effects.splice(index, 1);
    this.engine?.rebuild();
    this.emit('effectRemoved', id);
  }

  /** Updates one effect's parameters, merging partially. `effects.update(id, { value: 0.5 })`. */
  update(effectId: string, params: Partial<ColorOpParams>): void {
    const instance = this.require(effectId);
    const registration = this.customRegistrations.get(effectId);
    const specs = registration ? registration.effect.parameters : FILTER_DEFINITIONS[instance.type]?.params;
    const merged: ColorOpParams = { ...instance.params };
    for (const [name, value] of Object.entries(params)) {
      if (value !== undefined) merged[name] = value;
    }
    if (specs) validateParams(merged, specs);
    instance.params = merged;
    if (registration) {
      registration.effect.update(merged);
      instance.op = registration.effect.process(merged);
      registration.params = merged;
    }
    this.engine?.rebuild();
    this.emit('effectUpdated', instance);
  }

  /** Moves an effect to a new index. Order matters for how effects compose. */
  reorder(effectId: string, toIndex: number): void {
    const fromIndex = this._effects.findIndex((e) => e.id === effectId);
    if (fromIndex === -1) return;
    const [instance] = this._effects.splice(fromIndex, 1);
    const clampedIndex = Math.max(0, Math.min(toIndex, this._effects.length));
    this._effects.splice(clampedIndex, 0, instance);
    this.engine?.rebuild();
    this.emit(
      'reordered',
      this._effects.map((e) => e.id),
    );
  }

  /** No id enables the whole pipeline (bypass off). An id enables just that effect. */
  enable(effectId?: string): void {
    if (effectId) {
      this.require(effectId).enabled = true;
      this.engine?.rebuild();
    } else {
      this._isEnabled = true;
    }
    this.emit('enabled', effectId);
  }

  /** No id disables the whole pipeline, so the camera publishes unmodified. An id disables just that effect. */
  disable(effectId?: string): void {
    if (effectId) {
      this.require(effectId).enabled = false;
      this.engine?.rebuild();
    } else {
      this._isEnabled = false;
    }
    this.emit('disabled', effectId);
  }

  clear(): void {
    for (const id of this.customRegistrations.keys()) {
      void this.customRegistrations.get(id)?.effect.destroy();
    }
    this.customRegistrations.clear();
    this._effects = [];
    this.engine?.rebuild();
    this.emit('cleared');
  }

  private require(effectId: string): EffectInstance {
    const instance = this._effects.find((e) => e.id === effectId);
    if (!instance) {
      throw new EffectsError('RAVEN_EFFECT_INVALID_CONFIG', `No effect with id "${effectId}" in this pipeline.`);
    }
    return instance;
  }

  /**
   * @internal Called by `@ravenkash/rtc`'s `LocalTrack.attachEffects()`.
   * Nobody calls this directly. Starts processing `sourceTrack` and returns
   * the live output track to publish.
   */
  async attachToTrack(sourceTrack: MediaStreamTrack, engineOverride?: EffectsEngine): Promise<MediaStreamTrack> {
    if (this.engine) {
      throw new EffectsError(
        'RAVEN_EFFECT_INVALID_CONFIG',
        'This pipeline is already attached to a track. Detach it first.',
      );
    }
    if (!hasDocument()) {
      // No DOM whatsoever: React Native's JS runtime, a Node worker, that
      // sort of thing. Nothing to build an engine on, no video element, no
      // canvas. Fall back to the original track rather than throw a raw
      // ReferenceError. Native platforms get their own effects engine later
      // on (docs/effects/react-native).
      this.emit(
        'error',
        new EffectsError(
          'RAVEN_EFFECT_UNSUPPORTED',
          'Raven Effects has no DOM to render into in this environment; the camera track is unmodified.',
        ),
      );
      return sourceTrack;
    }
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    // Chrome, and others, throttle or flat-out never decode frames for a
    // <video> that isn't in the document. `requestVideoFrameCallback` just
    // never fires on a detached element. What actually keeps it decoding is
    // off-screen but attached. Not `display: none`, which some engines also
    // pause.
    video.setAttribute('aria-hidden', 'true');
    video.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:2px;height:2px;opacity:0;pointer-events:none;';
    document.body.appendChild(video);
    try {
      video.srcObject = new MediaStream([sourceTrack]);
      const playResult = video.play() as unknown;
      if (playResult && typeof (playResult as Promise<void>).catch === 'function') {
        await (playResult as Promise<void>).catch(() => {
          // Autoplay can still reject in some embedding contexts, even
          // though muted+playsInline normally satisfies autoplay policies.
          // Playback starts once the media element is attached to a live
          // document; nothing renders before that.
        });
      }
    } catch (error) {
      // A runtime that can't even build a video element from this track
      // can't run effects. Report it as unsupported and let the caller keep
      // the original track, rather than throwing out of a feature that was
      // optional to begin with.
      video.remove();
      this.emit(
        'error',
        error instanceof EffectsError
          ? error
          : new EffectsError(
              'RAVEN_EFFECT_UNSUPPORTED',
              'Could not attach the source track to a video element.',
              error,
            ),
      );
      return sourceTrack;
    }

    this.engine = engineOverride ?? selectEngine((error) => this.emit('error', error), detectCapabilities());
    this.videoEl = video;
    try {
      const outputTrack = this.engine.start(video, sourceTrack, () => (this._isEnabled ? this._effects : []));
      this.startStatsTimer();
      return outputTrack;
    } catch (error) {
      this.engine = undefined;
      video.remove();
      this.videoEl = undefined;
      const effectsError =
        error instanceof EffectsError
          ? error
          : new EffectsError('RAVEN_EFFECT_PROCESSING_FAILED', 'Failed to start effects engine.', error);
      this.emit('error', effectsError);
      // Graceful degradation (§9/§31). The call carries on with the
      // original track.
      return sourceTrack;
    }
  }

  /** @internal Stops processing and releases engine resources. */
  detach(): void {
    this.stopStatsTimer();
    this.engine?.stop();
    this.engine = undefined;
    if (this.videoEl) {
      this.videoEl.srcObject = null;
      this.videoEl.remove();
      this.videoEl = undefined;
    }
  }

  get engineKind(): EngineKind | undefined {
    return this.engine?.kind;
  }

  getStats(): PipelineStats | undefined {
    return this.engine?.getStats();
  }

  private startStatsTimer(): void {
    this.statsTimer = setInterval(() => {
      const stats = this.engine?.getStats();
      if (stats) this.emit('stats', stats);
    }, 2000);
  }

  private stopStatsTimer(): void {
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = undefined;
    }
  }
}

export function createEffectsPipeline(): EffectsPipeline {
  return new EffectsPipeline();
}
