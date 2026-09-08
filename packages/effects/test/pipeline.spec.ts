import { createEffectsPipeline } from '@/pipeline';
import { filters } from '@/filters/index';
import { presets } from '@/presets';
import { EFFECT_SECURITY_LIMITS } from '@/security';
import { createFakeVideoTrack } from './helpers/fake-track';
import type { RavenEffect } from '@/types';
import type { EffectsEngine, PipelineStats } from '@/engine/types';

class FakeEngine implements EffectsEngine {
  readonly kind = 'canvas2d' as const;
  rebuildCalls = 0;
  stopped = false;
  outputTrack = createFakeVideoTrack({ id: 'processed-track' });

  start(): MediaStreamTrack {
    return this.outputTrack;
  }

  rebuild(): void {
    this.rebuildCalls += 1;
  }

  stop(): void {
    this.stopped = true;
  }

  getStats(): PipelineStats {
    return { engine: this.kind, fps: 30, averageFrameTimeMs: 2, droppedFrames: 0, framesProcessed: 100 };
  }
}

describe('EffectsPipeline; lifecycle', () => {
  it('add() appends an enabled effect and emits effectAdded', () => {
    const pipeline = createEffectsPipeline();
    const handler = jest.fn();
    pipeline.on('effectAdded', handler);

    const instance = pipeline.add(filters.brightness({ value: 0.2 }));

    expect(pipeline.effects).toHaveLength(1);
    expect(instance.enabled).toBe(true);
    expect(instance.params.value).toBe(0.2);
    expect(handler).toHaveBeenCalledWith(instance);
  });

  it('applyPreset() adds every filter in the preset, in order', () => {
    const pipeline = createEffectsPipeline();
    const instances = pipeline.applyPreset(presets.cinematic);
    expect(instances.map((i) => i.type)).toEqual(['contrast', 'saturation', 'temperature']);
    expect(pipeline.effects).toHaveLength(3);
  });

  it('remove() accepts either an instance or an id, and emits effectRemoved', () => {
    const pipeline = createEffectsPipeline();
    const a = pipeline.add(filters.brightness());
    const b = pipeline.add(filters.contrast());
    const handler = jest.fn();
    pipeline.on('effectRemoved', handler);

    pipeline.remove(a);
    pipeline.remove(b.id);

    expect(pipeline.effects).toHaveLength(0);
    expect(handler).toHaveBeenCalledWith(a.id);
    expect(handler).toHaveBeenCalledWith(b.id);
  });

  it('update() merges params, validates them, and emits effectUpdated', () => {
    const pipeline = createEffectsPipeline();
    const instance = pipeline.add(filters.brightness({ value: 0.1 }));
    const handler = jest.fn();
    pipeline.on('effectUpdated', handler);

    pipeline.update(instance.id, { value: 0.5 });

    expect(instance.params.value).toBe(0.5);
    expect(handler).toHaveBeenCalledWith(instance);
    expect(() => pipeline.update(instance.id, { value: 99 })).toThrow();
  });

  it('reorder() moves an effect to the requested index', () => {
    const pipeline = createEffectsPipeline();
    const a = pipeline.add(filters.brightness());
    const b = pipeline.add(filters.contrast());
    const c = pipeline.add(filters.saturation());

    pipeline.reorder(a.id, 2);

    expect(pipeline.effects.map((e) => e.id)).toEqual([b.id, c.id, a.id]);
  });

  it('enable()/disable() with no id toggle the whole pipeline; with an id, toggle one effect', () => {
    const pipeline = createEffectsPipeline();
    const instance = pipeline.add(filters.brightness());

    pipeline.disable();
    expect(pipeline.isEnabled).toBe(false);
    pipeline.enable();
    expect(pipeline.isEnabled).toBe(true);

    pipeline.disable(instance.id);
    expect(instance.enabled).toBe(false);
    pipeline.enable(instance.id);
    expect(instance.enabled).toBe(true);
  });

  it('clear() removes every effect and emits cleared', () => {
    const pipeline = createEffectsPipeline();
    pipeline.add(filters.brightness());
    pipeline.add(filters.contrast());
    const handler = jest.fn();
    pipeline.on('cleared', handler);

    pipeline.clear();

    expect(pipeline.effects).toHaveLength(0);
    expect(handler).toHaveBeenCalled();
  });

  it('enforces the pipeline length security limit', () => {
    const pipeline = createEffectsPipeline();
    for (let i = 0; i < EFFECT_SECURITY_LIMITS.MAX_PIPELINE_LENGTH; i++) {
      pipeline.add(filters.brightness());
    }
    expect(() => pipeline.add(filters.brightness())).toThrow();
  });

  it('update()/remove() on an unknown id throws or no-ops safely rather than corrupting state', () => {
    const pipeline = createEffectsPipeline();
    expect(() => pipeline.update('nope', { value: 0.1 })).toThrow();
    expect(() => pipeline.remove('nope')).not.toThrow();
  });
});

describe('EffectsPipeline; custom effects (§19, trusted-only)', () => {
  function makeCustomEffect(): RavenEffect {
    return {
      id: 'my-custom',
      name: 'My Custom',
      version: '1.0.0',
      supportedPlatforms: ['web'],
      parameters: { strength: { min: 0, max: 1, default: 0.5, description: 'x' } },
      initialize: jest.fn(),
      process: jest.fn((params) => ({
        kind: 'color' as const,
        glsl: () => `color = color * ${params.strength};`,
        applyToPixel: (pixel: [number, number, number]) => pixel,
      })),
      update: jest.fn(),
      destroy: jest.fn(),
    };
  }

  it('registers a custom effect and calls process() with validated params', () => {
    const pipeline = createEffectsPipeline();
    const effect = makeCustomEffect();

    const instance = pipeline.addCustomEffect(effect, { strength: 0.8 });

    expect(instance.params.strength).toBe(0.8);
    expect(effect.process).toHaveBeenCalledWith({ strength: 0.8 });
  });

  it('update() calls the custom effect update()/process() and re-derives the op', () => {
    const pipeline = createEffectsPipeline();
    const effect = makeCustomEffect();
    const instance = pipeline.addCustomEffect(effect);

    pipeline.update(instance.id, { strength: 0.9 });

    expect(effect.update).toHaveBeenCalledWith(expect.objectContaining({ strength: 0.9 }));
    expect(effect.process).toHaveBeenLastCalledWith(expect.objectContaining({ strength: 0.9 }));
  });

  it('remove() calls destroy() on the custom effect', () => {
    const pipeline = createEffectsPipeline();
    const effect = makeCustomEffect();
    const instance = pipeline.addCustomEffect(effect);

    pipeline.remove(instance.id);

    expect(effect.destroy).toHaveBeenCalled();
  });
});

describe('EffectsPipeline; attach/detach to a track', () => {
  it('attachToTrack() starts the given engine and returns its output track', async () => {
    const pipeline = createEffectsPipeline();
    const engine = new FakeEngine();
    const source = createFakeVideoTrack();

    const output = await pipeline.attachToTrack(source, engine);

    expect(output).toBe(engine.outputTrack);
    expect(pipeline.engineKind).toBe('canvas2d');
  });

  it('rebuilds the engine when the effect list changes after attaching', async () => {
    const pipeline = createEffectsPipeline();
    const engine = new FakeEngine();
    await pipeline.attachToTrack(createFakeVideoTrack(), engine);

    pipeline.add(filters.brightness());
    pipeline.update(pipeline.effects[0].id, { value: 0.3 });
    pipeline.remove(pipeline.effects[0].id);

    expect(engine.rebuildCalls).toBeGreaterThanOrEqual(3);
  });

  it('detach() stops the engine', async () => {
    const pipeline = createEffectsPipeline();
    const engine = new FakeEngine();
    await pipeline.attachToTrack(createFakeVideoTrack(), engine);

    pipeline.detach();

    expect(engine.stopped).toBe(true);
  });

  it('rejects attaching twice without detaching first', async () => {
    const pipeline = createEffectsPipeline();
    await pipeline.attachToTrack(createFakeVideoTrack(), new FakeEngine());
    await expect(pipeline.attachToTrack(createFakeVideoTrack(), new FakeEngine())).rejects.toThrow();
  });

  it('with no engine override, falls back gracefully in a jsdom environment lacking WebGL2/captureStream (§9/§31)', async () => {
    const pipeline = createEffectsPipeline();
    const source = createFakeVideoTrack();

    const output = await pipeline.attachToTrack(source);

    // jsdom has neither WebGL2 nor HTMLCanvasElement.captureStream, so
    // capability detection has to pick the passthrough engine and hand back
    // the original track.
    expect(output).toBe(source);
  });

  it('degrades to the original track (never throws) when there is no DOM at all, e.g. React Native (§9/§31)', async () => {
    jest.resetModules();
    jest.doMock('../src/dom', () => ({ hasDocument: () => false }));
    const { createEffectsPipeline: createPipelineWithoutDom } = await import('../src/pipeline');

    const pipeline = createPipelineWithoutDom();
    const errorHandler = jest.fn();
    pipeline.on('error', errorHandler);
    const source = createFakeVideoTrack();

    const output = await pipeline.attachToTrack(source);

    expect(output).toBe(source);
    expect(errorHandler).toHaveBeenCalledWith(expect.objectContaining({ code: 'RAVEN_EFFECT_UNSUPPORTED' }));

    jest.dontMock('../src/dom');
    jest.resetModules();
  });
});
