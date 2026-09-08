import { createEffectsPipeline, filters, presets, EFFECTS_NATIVE_ENGINE_STATUS } from '../src/effects';
import { LocalTrack } from '@corvidhq/rtc';
import type { LocalTrackDelegate } from '@corvidhq/rtc';

/**
 * Runs under `testEnvironment: node` (see package.json), so there really is
 * no `document` or DOM here, exactly like the real React Native JS runtime.
 *
 * It exists to prove the §31 "no fake implementation" claim properly:
 * attachEffects() has to degrade to the original track, not throw a raw
 * ReferenceError and not quietly pretend to process frames.
 */
describe('Raven Effects on React Native (Phase 16 architecture)', () => {
  it('reports the native engine as planned, not production', () => {
    expect(EFFECTS_NATIVE_ENGINE_STATUS).toBe('planned');
  });

  it('filter/preset configuration works with no native code involved', () => {
    const pipeline = createEffectsPipeline();
    const instance = pipeline.add(filters.brightness({ value: 0.2 }));
    expect(instance.params.value).toBe(0.2);

    const cinematic = pipeline.applyPreset(presets.cinematic);
    expect(cinematic.map((e) => e.type)).toEqual(['contrast', 'saturation', 'temperature']);
  });

  it('camera.attachEffects() degrades to the unmodified track (no DOM here, exactly like a real device) and reports why', async () => {
    const mediaStreamTrack = { id: 'camera-1', stop: jest.fn() } as unknown as MediaStreamTrack;
    const delegate: LocalTrackDelegate = {
      mediaStreamTrack,
      isMuted: false,
      attach: jest.fn(),
      detach: jest.fn(),
      mute: jest.fn().mockResolvedValue(undefined),
      unmute: jest.fn().mockResolvedValue(undefined),
      replaceTrack: jest.fn().mockResolvedValue(undefined),
    };
    const track = new LocalTrack(delegate, 'camera');
    const pipeline = createEffectsPipeline();
    const errors: unknown[] = [];
    pipeline.on('error', (e) => errors.push(e));

    await track.attachEffects(pipeline);

    // No native engine yet, so the pipeline never swapped the published
    // track.
    expect(delegate.replaceTrack).not.toHaveBeenCalled();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: 'RAVEN_EFFECT_UNSUPPORTED' });
  });
});
