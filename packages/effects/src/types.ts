/** Platforms Raven Effects (or an individual effect) can run on. */
export type EffectPlatform = 'web' | 'react' | 'react-native' | 'flutter';

/** Maturity of a capability — never claim "production" unless it's actually shipped and tested. */
export type EffectSupportStatus = 'production' | 'experimental' | 'planned' | 'unsupported';

export type EffectCategory = 'color' | 'spatial' | 'custom';

/** A single normalized color-adjustment operation, folded into one fragment shader pass with its neighbors. */
export interface ColorOpParams {
  [param: string]: number;
}

/** Renders one color-adjustment step as a GLSL statement operating on a `vec3 color` in [0,1] (WebGL engine)
 *  and as a pixel-level transform over an RGBA byte buffer (Canvas2D fallback engine). Both must agree. */
export interface ColorOp {
  kind: 'color';
  glsl(params: ColorOpParams): string;
  applyToPixel(rgb: [number, number, number], params: ColorOpParams): [number, number, number];
}

/** A spatially-dependent operation (reads neighboring pixels) — gets its own render pass. */
export interface SpatialOp {
  kind: 'spatial';
  /** WebGL: renders `source` into `target` (a framebuffer-backed texture) at `width`x`height`. */
  renderGL(gl: WebGL2RenderingContext, source: WebGLTexture, target: WebGLFramebuffer, width: number, height: number, params: ColorOpParams): void;
  /** Canvas2D fallback: mutates `imageData` in place. */
  applyToImageData(imageData: ImageData, params: ColorOpParams): void;
}

export type EffectOp = ColorOp | SpatialOp;

/** A parameter's documented valid range, used for validation and for the dashboard/docs. */
export interface EffectParamSpec {
  min: number;
  max: number;
  default: number;
  description: string;
}

/** Static description of a filter type — shared by every instance of that filter. */
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
  /** The actual GPU/CPU operation this instance runs — engines consume this directly, never look types back up in a registry. */
  op: EffectOp;
}

/**
 * Future-safe interface for a custom, developer-authored effect (RavenEffect —
 * Phase 16 §19). Only *internal/trusted* effects can be registered today: there
 * is no sandboxed execution model yet, so Raven Effects never loads or runs
 * developer-supplied remote code (JS/WASM/shaders) — see security.ts.
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

/** Per-platform support row, as surfaced in the dashboard (§23) and docs. */
export interface EffectPlatformSupport {
  web: EffectSupportStatus;
  react: EffectSupportStatus;
  reactNative: EffectSupportStatus;
  flutter: EffectSupportStatus;
}
