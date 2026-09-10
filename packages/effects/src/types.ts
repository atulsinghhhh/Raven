/** Platforms Livqeno Effects (or an individual effect) can run on. */
export type EffectPlatform = 'web' | 'react' | 'react-native' | 'flutter';

/** How mature a capability is. Never claim "production" unless it's genuinely shipped and tested. */
export type EffectSupportStatus = 'production' | 'experimental' | 'planned' | 'unsupported';

export type EffectCategory = 'color' | 'spatial' | 'custom';

/** One normalized colour-adjustment operation, folded into a single fragment shader pass with its neighbours. */
export interface ColorOpParams {
  [param: string]: number;
}

/** Renders one colour-adjustment step two ways: as a GLSL statement over a
 *  `vec3 color` in [0,1] for the WebGL engine, and as a pixel-level transform
 *  over an RGBA byte buffer for the Canvas2D fallback. The two have to agree. */
export interface ColorOp {
  kind: 'color';
  glsl(params: ColorOpParams): string;
  applyToPixel(rgb: [number, number, number], params: ColorOpParams): [number, number, number];
}

/** A spatially-dependent operation, one that reads neighbouring pixels. Gets its own render pass. */
export interface SpatialOp {
  kind: 'spatial';
  /** WebGL: renders `source` into `target`, a framebuffer-backed texture, at `width`x`height`. */
  renderGL(
    gl: WebGL2RenderingContext,
    source: WebGLTexture,
    target: WebGLFramebuffer,
    width: number,
    height: number,
    params: ColorOpParams,
  ): void;
  /** Canvas2D fallback: mutates `imageData` in place. */
  applyToImageData(imageData: ImageData, params: ColorOpParams): void;
}

export type EffectOp = ColorOp | SpatialOp;

/** A parameter's documented valid range. Used for validation, and by the dashboard and docs. */
export interface EffectParamSpec {
  min: number;
  max: number;
  default: number;
  description: string;
}

/** Static description of a filter type, shared by every instance of it. */
export interface EffectDefinition {
  type: string;
  category: EffectCategory;
  params: Record<string, EffectParamSpec>;
  op: EffectOp;
}

/** One configured, addressable step in an EffectsPipeline. */
export interface EffectInstance {
  readonly id: string;
  readonly type: string;
  readonly name: string;
  enabled: boolean;
  params: ColorOpParams;
  /** The actual GPU or CPU operation this instance runs. Engines consume it directly; they never look the type back up in a registry. */
  op: EffectOp;
}

/**
 * Future-safe interface for a custom, developer-authored effect
 * (RavenEffect, Phase 16 §19).
 *
 * Today only *internal and trusted* effects can be registered. There's no
 * sandboxed execution model yet, so Livqeno Effects never loads or runs
 * developer-supplied remote code, whether that's JS, WASM or shaders. See
 * security.ts.
 */
export interface RavenEffect {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly supportedPlatforms: EffectPlatform[];
  readonly parameters: Record<string, EffectParamSpec>;
  initialize(): void | Promise<void>;
  process(params: ColorOpParams): EffectOp;
  update(params: ColorOpParams): void;
  destroy(): void | Promise<void>;
}

/** One per-platform support row, as the dashboard (§23) and the docs show it. */
export interface EffectPlatformSupport {
  web: EffectSupportStatus;
  react: EffectSupportStatus;
  reactNative: EffectSupportStatus;
  flutter: EffectSupportStatus;
}
