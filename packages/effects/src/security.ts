import { EffectsError } from './errors';
import type { EffectParamSpec } from './types';

/**
 * Security limits for anything Raven Effects loads or accepts from a
 * developer. These exist because effects sit directly in the real-time
 * video path — an oversized asset or pathological parameter can stall a
 * call for every participant, not just the caller.
 */
export const EFFECT_SECURITY_LIMITS = {
  /** Max bytes for an effect asset (e.g. an AR overlay image) — see §18/§20. */
  MAX_ASSET_BYTES: 5 * 1024 * 1024,
  /** Max width/height for an effect asset, to bound GPU texture memory. */
  MAX_ASSET_DIMENSION: 4096,
  /** Effect asset MIME types Raven Effects will decode. Never SVG (script risk) or arbitrary binary. */
  ALLOWED_ASSET_TYPES: ['image/png', 'image/jpeg', 'image/webp'] as const,
  /** A pipeline is real-time infrastructure, not a compositor — cap the chain length. */
  MAX_PIPELINE_LENGTH: 16,
} as const;

/**
 * Validates a numeric effect parameter against its documented range.
 * Raven Effects rejects invalid values rather than silently clamping them,
 * so a developer's bug surfaces immediately instead of shipping a
 * slightly-wrong filter to production.
 */
export function validateParam(name: string, value: number, spec: EffectParamSpec): void {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    throw new EffectsError('RAVEN_EFFECT_INVALID_CONFIG', `Parameter "${name}" must be a finite number, got ${String(value)}.`);
  }
  if (value < spec.min || value > spec.max) {
    throw new EffectsError(
      'RAVEN_EFFECT_INVALID_CONFIG',
      `Parameter "${name}" must be between ${spec.min} and ${spec.max} (got ${value}). ${spec.description}`,
    );
  }
}

export function validateParams(params: Record<string, number>, specs: Record<string, EffectParamSpec>): void {
  for (const [name, spec] of Object.entries(specs)) {
    const value = params[name] ?? spec.default;
    validateParam(name, value, spec);
  }
  for (const name of Object.keys(params)) {
    if (!(name in specs)) {
      throw new EffectsError('RAVEN_EFFECT_INVALID_CONFIG', `Unknown parameter "${name}" for this effect.`);
    }
  }
}

export function assertPipelineNotFull(currentLength: number): void {
  if (currentLength >= EFFECT_SECURITY_LIMITS.MAX_PIPELINE_LENGTH) {
    throw new EffectsError(
      'RAVEN_EFFECT_RESOURCE_LIMIT',
      `Pipeline already has the maximum of ${EFFECT_SECURITY_LIMITS.MAX_PIPELINE_LENGTH} effects.`,
    );
  }
}

export interface AssetDescriptor {
  byteLength: number;
  mimeType: string;
  width?: number;
  height?: number;
}

/**
 * Validates an asset (e.g. an AR sticker image) before it is decoded —
 * size/type/dimension checks happen before any bytes are handed to an
 * image decoder, never after.
 */
export function validateAsset(asset: AssetDescriptor): void {
  if (asset.byteLength <= 0 || asset.byteLength > EFFECT_SECURITY_LIMITS.MAX_ASSET_BYTES) {
    throw new EffectsError(
      'RAVEN_EFFECT_RESOURCE_LIMIT',
      `Effect asset is ${asset.byteLength} bytes; must be between 1 and ${EFFECT_SECURITY_LIMITS.MAX_ASSET_BYTES} bytes.`,
    );
  }
  if (!(EFFECT_SECURITY_LIMITS.ALLOWED_ASSET_TYPES as readonly string[]).includes(asset.mimeType)) {
    throw new EffectsError(
      'RAVEN_EFFECT_INVALID_CONFIG',
      `Effect asset type "${asset.mimeType}" is not allowed. Allowed types: ${EFFECT_SECURITY_LIMITS.ALLOWED_ASSET_TYPES.join(', ')}.`,
    );
  }
  if (
    (asset.width !== undefined && asset.width > EFFECT_SECURITY_LIMITS.MAX_ASSET_DIMENSION) ||
    (asset.height !== undefined && asset.height > EFFECT_SECURITY_LIMITS.MAX_ASSET_DIMENSION)
  ) {
    throw new EffectsError(
      'RAVEN_EFFECT_RESOURCE_LIMIT',
      `Effect asset dimensions exceed the ${EFFECT_SECURITY_LIMITS.MAX_ASSET_DIMENSION}px limit.`,
    );
  }
}

/**
 * Raven Effects never loads a shader, script, or WASM module from a
 * caller-supplied URL. Custom `RavenEffect`s (§19) must be registered as
 * in-memory objects the host application already trusts (its own bundle) —
 * there is no `loadEffectFromUrl()`-style API, and this function exists so
 * that fact is enforced at the type/runtime boundary rather than just
 * documented. See docs/effects/api-reference for the full trust model.
 */
export function assertNoRemoteCodeExecution(_source: unknown): asserts _source is never {
  throw new EffectsError(
    'RAVEN_EFFECT_PERMISSION_DENIED',
    'Raven Effects does not support loading effects, shaders, or scripts from a URL. ' +
      'Register a RavenEffect object directly from code you already trust.',
  );
}
