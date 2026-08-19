import { EffectsError } from '../errors';
import type { ColorOpParams, EffectDefinition } from '../types';
import { validateParams } from '../security';
import { blurDefinition } from './blur';
import { brightnessDefinition } from './brightness';
import { contrastDefinition } from './contrast';
import { exposureDefinition } from './exposure';
import { grayscaleDefinition } from './grayscale';
import { saturationDefinition } from './saturation';
import { sepiaDefinition } from './sepia';
import { temperatureDefinition } from './temperature';
import { tintDefinition } from './tint';
import { beautySmoothDefinition } from '../foundations/beauty';

/**
 * Every filter Raven Effects can run, keyed by type — the 9 basic filters
 * (Phase 16 §3) plus `beautySmooth` (§16), all engines and the pipeline
 * resolve ops through this one registry.
 */
export const FILTER_DEFINITIONS: Record<string, EffectDefinition> = {
  brightness: brightnessDefinition,
  contrast: contrastDefinition,
  saturation: saturationDefinition,
  exposure: exposureDefinition,
  temperature: temperatureDefinition,
  tint: tintDefinition,
  grayscale: grayscaleDefinition,
  sepia: sepiaDefinition,
  blur: blurDefinition,
  beautySmooth: beautySmoothDefinition,
};

export interface FilterConfig {
  type: string;
  name: string;
  params: ColorOpParams;
}

/** A filter factory validates its params up front — see `raven.effects.filters.brightness({...})`. */
export function makeFilterFactory(type: string) {
  const definition = FILTER_DEFINITIONS[type];
  if (!definition) {
    throw new EffectsError('RAVEN_EFFECT_UNSUPPORTED', `Unknown filter type "${type}".`);
  }
  return (params: Partial<ColorOpParams> = {}): FilterConfig => {
    const merged: ColorOpParams = {};
    for (const [name, spec] of Object.entries(definition.params)) {
      merged[name] = params[name] ?? spec.default;
    }
    validateParams(merged, definition.params);
    return { type, name: type, params: merged };
  };
}

export const filters = {
  brightness: makeFilterFactory('brightness'),
  contrast: makeFilterFactory('contrast'),
  saturation: makeFilterFactory('saturation'),
  exposure: makeFilterFactory('exposure'),
  temperature: makeFilterFactory('temperature'),
  tint: makeFilterFactory('tint'),
  grayscale: makeFilterFactory('grayscale'),
  sepia: makeFilterFactory('sepia'),
  blur: makeFilterFactory('blur'),
};

export {
  blurDefinition,
  brightnessDefinition,
  contrastDefinition,
  exposureDefinition,
  grayscaleDefinition,
  saturationDefinition,
  sepiaDefinition,
  temperatureDefinition,
  tintDefinition,
};
