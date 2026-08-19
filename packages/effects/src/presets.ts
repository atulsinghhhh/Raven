import { filters, type FilterConfig } from './filters/index';

/**
 * Presets are pure composition over the basic filters (Phase 16 §4) — no
 * preset defines its own pixel math. Each returns the ordered list of
 * filter configs `EffectsPipeline.applyPreset()` adds in sequence.
 */
export type Preset = () => FilterConfig[];

const vivid: Preset = () => [
  filters.saturation({ value: 1.4 }),
  filters.contrast({ value: 0.15 }),
  filters.brightness({ value: 0.03 }),
];

const warm: Preset = () => [filters.temperature({ value: 0.35 }), filters.tint({ value: 0.05 }), filters.saturation({ value: 1.1 })];

const cool: Preset = () => [filters.temperature({ value: -0.35 }), filters.saturation({ value: 1.05 })];

const cinematic: Preset = () => [
  filters.contrast({ value: 0.2 }),
  filters.saturation({ value: 0.85 }),
  filters.temperature({ value: 0.1 }),
];

const vintage: Preset = () => [
  filters.sepia({ amount: 0.35 }),
  filters.contrast({ value: -0.1 }),
  filters.saturation({ value: 0.7 }),
  filters.brightness({ value: 0.02 }),
];

export const presets = { vivid, warm, cool, cinematic, vintage };
