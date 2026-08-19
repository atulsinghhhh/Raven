// src/capabilities.ts
function detectCapabilities(win = globalThis) {
  const doc = win.document;
  let webgl2 = false;
  try {
    const canvas = doc?.createElement("canvas");
    webgl2 = !!canvas?.getContext("webgl2");
  } catch {
    webgl2 = false;
  }
  const offscreenCanvas = typeof win.OffscreenCanvas === "function";
  const captureStream = typeof win.HTMLCanvasElement?.prototype?.captureStream === "function";
  const requestVideoFrameCallback = typeof win.HTMLVideoElement?.prototype?.requestVideoFrameCallback === "function";
  let recommendedEngine = "passthrough";
  if (captureStream && webgl2) {
    recommendedEngine = "webgl2";
  } else if (captureStream) {
    recommendedEngine = "canvas2d";
  }
  return { webgl2, offscreenCanvas, captureStream, requestVideoFrameCallback, recommendedEngine };
}

// src/dom.ts
function hasDocument() {
  return typeof document !== "undefined";
}

// src/errors.ts
var EffectsError = class extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = "EffectsError";
    this.code = code;
    this.cause = cause;
  }
};
function isEffectsError(value) {
  return value instanceof EffectsError;
}

// src/events.ts
var TypedEventEmitter = class {
  constructor() {
    this.listeners = /* @__PURE__ */ new Map();
  }
  on(event, handler) {
    let set = this.listeners.get(event);
    if (!set) {
      set = /* @__PURE__ */ new Set();
      this.listeners.set(event, set);
    }
    set.add(handler);
    return this;
  }
  off(event, handler) {
    this.listeners.get(event)?.delete(handler);
    return this;
  }
  once(event, handler) {
    const wrapped = ((...args) => {
      this.off(event, wrapped);
      handler(...args);
    });
    return this.on(event, wrapped);
  }
  removeAllListeners(event) {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
    return this;
  }
  emit(event, ...args) {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const handler of Array.from(set)) {
      handler(...args);
    }
  }
};

// src/security.ts
var EFFECT_SECURITY_LIMITS = {
  /** Max bytes for an effect asset (e.g. an AR overlay image) — see §18/§20. */
  MAX_ASSET_BYTES: 5 * 1024 * 1024,
  /** Max width/height for an effect asset, to bound GPU texture memory. */
  MAX_ASSET_DIMENSION: 4096,
  /** Effect asset MIME types Raven Effects will decode. Never SVG (script risk) or arbitrary binary. */
  ALLOWED_ASSET_TYPES: ["image/png", "image/jpeg", "image/webp"],
  /** A pipeline is real-time infrastructure, not a compositor — cap the chain length. */
  MAX_PIPELINE_LENGTH: 16
};
function validateParam(name, value, spec) {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    throw new EffectsError("RAVEN_EFFECT_INVALID_CONFIG", `Parameter "${name}" must be a finite number, got ${String(value)}.`);
  }
  if (value < spec.min || value > spec.max) {
    throw new EffectsError(
      "RAVEN_EFFECT_INVALID_CONFIG",
      `Parameter "${name}" must be between ${spec.min} and ${spec.max} (got ${value}). ${spec.description}`
    );
  }
}
function validateParams(params, specs) {
  for (const [name, spec] of Object.entries(specs)) {
    const value = params[name] ?? spec.default;
    validateParam(name, value, spec);
  }
  for (const name of Object.keys(params)) {
    if (!(name in specs)) {
      throw new EffectsError("RAVEN_EFFECT_INVALID_CONFIG", `Unknown parameter "${name}" for this effect.`);
    }
  }
}
function assertPipelineNotFull(currentLength) {
  if (currentLength >= EFFECT_SECURITY_LIMITS.MAX_PIPELINE_LENGTH) {
    throw new EffectsError(
      "RAVEN_EFFECT_RESOURCE_LIMIT",
      `Pipeline already has the maximum of ${EFFECT_SECURITY_LIMITS.MAX_PIPELINE_LENGTH} effects.`
    );
  }
}
function validateAsset(asset) {
  if (asset.byteLength <= 0 || asset.byteLength > EFFECT_SECURITY_LIMITS.MAX_ASSET_BYTES) {
    throw new EffectsError(
      "RAVEN_EFFECT_RESOURCE_LIMIT",
      `Effect asset is ${asset.byteLength} bytes; must be between 1 and ${EFFECT_SECURITY_LIMITS.MAX_ASSET_BYTES} bytes.`
    );
  }
  if (!EFFECT_SECURITY_LIMITS.ALLOWED_ASSET_TYPES.includes(asset.mimeType)) {
    throw new EffectsError(
      "RAVEN_EFFECT_INVALID_CONFIG",
      `Effect asset type "${asset.mimeType}" is not allowed. Allowed types: ${EFFECT_SECURITY_LIMITS.ALLOWED_ASSET_TYPES.join(", ")}.`
    );
  }
  if (asset.width !== void 0 && asset.width > EFFECT_SECURITY_LIMITS.MAX_ASSET_DIMENSION || asset.height !== void 0 && asset.height > EFFECT_SECURITY_LIMITS.MAX_ASSET_DIMENSION) {
    throw new EffectsError(
      "RAVEN_EFFECT_RESOURCE_LIMIT",
      `Effect asset dimensions exceed the ${EFFECT_SECURITY_LIMITS.MAX_ASSET_DIMENSION}px limit.`
    );
  }
}

// src/filters/blur.ts
function gaussianWeights(radius) {
  const sigma = Math.max(radius / 2, 1e-4);
  const taps = Math.max(1, Math.ceil(radius));
  const weights = [];
  for (let i = -taps; i <= taps; i++) {
    weights.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
  }
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => w / sum);
}
var blurOp = {
  kind: "spatial",
  renderGL(gl, source, target, width, height, params) {
  },
  applyToImageData(imageData, params) {
    const radius = Math.round(params.radius);
    if (radius <= 0) return;
    boxBlurApprox(imageData, radius);
  }
};
function boxBlurApprox(imageData, radius) {
  const { width, height, data } = imageData;
  const passes = 3;
  for (let p = 0; p < passes; p++) {
    horizontalPass(data, width, height, radius);
    verticalPass(data, width, height, radius);
  }
}
function horizontalPass(data, width, height, radius) {
  const copy = Uint8ClampedArray.from(data);
  const windowSize = radius * 2 + 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let k = -radius; k <= radius; k++) {
        const sx = Math.min(width - 1, Math.max(0, x + k));
        const idx2 = (y * width + sx) * 4;
        r += copy[idx2];
        g += copy[idx2 + 1];
        b += copy[idx2 + 2];
        a += copy[idx2 + 3];
      }
      const idx = (y * width + x) * 4;
      data[idx] = r / windowSize;
      data[idx + 1] = g / windowSize;
      data[idx + 2] = b / windowSize;
      data[idx + 3] = a / windowSize;
    }
  }
}
function verticalPass(data, width, height, radius) {
  const copy = Uint8ClampedArray.from(data);
  const windowSize = radius * 2 + 1;
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let k = -radius; k <= radius; k++) {
        const sy = Math.min(height - 1, Math.max(0, y + k));
        const idx2 = (sy * width + x) * 4;
        r += copy[idx2];
        g += copy[idx2 + 1];
        b += copy[idx2 + 2];
        a += copy[idx2 + 3];
      }
      const idx = (y * width + x) * 4;
      data[idx] = r / windowSize;
      data[idx + 1] = g / windowSize;
      data[idx + 2] = b / windowSize;
      data[idx + 3] = a / windowSize;
    }
  }
}
var blurDefinition = {
  type: "blur",
  category: "spatial",
  params: {
    radius: { min: 0, max: 20, default: 6, description: "Blur radius in pixels, 0 (none) to 20." }
  },
  op: blurOp
};

// src/filters/util.ts
function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
function luma(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

// src/filters/brightness.ts
var brightnessDefinition = {
  type: "brightness",
  category: "color",
  params: {
    value: { min: -1, max: 1, default: 0, description: "Additive brightness shift, -1 (darker) to 1 (brighter). 0 = no change." }
  },
  op: {
    kind: "color",
    glsl: (params) => `color = clamp(color + vec3(${params.value.toFixed(6)}), 0.0, 1.0);`,
    applyToPixel: ([r, g, b], params) => {
      const shift = params.value * 255;
      return [clamp01((r + shift) / 255) * 255, clamp01((g + shift) / 255) * 255, clamp01((b + shift) / 255) * 255];
    }
  }
};

// src/filters/contrast.ts
var contrastDefinition = {
  type: "contrast",
  category: "color",
  params: {
    value: { min: -1, max: 1, default: 0, description: "Contrast adjustment around mid-gray, -1 (flat) to 1 (max contrast). 0 = no change." }
  },
  op: {
    kind: "color",
    glsl: (params) => `color = clamp((color - 0.5) * (1.0 + ${params.value.toFixed(6)}) + 0.5, 0.0, 1.0);`,
    applyToPixel: ([r, g, b], params) => {
      const factor = 1 + params.value;
      const adj = (c) => clamp01((c / 255 - 0.5) * factor + 0.5) * 255;
      return [adj(r), adj(g), adj(b)];
    }
  }
};

// src/filters/exposure.ts
var exposureDefinition = {
  type: "exposure",
  category: "color",
  params: {
    stops: { min: -2, max: 2, default: 0, description: "Exposure adjustment in stops, -2 to 2. Each +1 doubles brightness. 0 = no change." }
  },
  op: {
    kind: "color",
    glsl: (params) => `color = clamp(color * pow(2.0, ${params.stops.toFixed(6)}), 0.0, 1.0);`,
    applyToPixel: ([r, g, b], params) => {
      const factor = Math.pow(2, params.stops);
      const adj = (c) => clamp01(c / 255 * factor) * 255;
      return [adj(r), adj(g), adj(b)];
    }
  }
};

// src/filters/grayscale.ts
var grayscaleDefinition = {
  type: "grayscale",
  category: "color",
  params: {
    amount: { min: 0, max: 1, default: 1, description: "Blend toward grayscale, 0 (none) to 1 (full)." }
  },
  op: {
    kind: "color",
    glsl: (params) => `{
      float l = dot(color, vec3(0.299, 0.587, 0.114));
      color = clamp(mix(color, vec3(l), ${params.amount.toFixed(6)}), 0.0, 1.0);
    }`,
    applyToPixel: ([r, g, b], params) => {
      const l = luma(r, g, b);
      const mix = (c) => clamp01((c + (l - c) * params.amount) / 255) * 255;
      return [mix(r), mix(g), mix(b)];
    }
  }
};

// src/filters/saturation.ts
var saturationDefinition = {
  type: "saturation",
  category: "color",
  params: {
    value: { min: 0, max: 2, default: 1, description: "Saturation multiplier, 0 (grayscale) to 2 (double). 1 = no change." }
  },
  op: {
    kind: "color",
    glsl: (params) => `{
      float l = dot(color, vec3(0.299, 0.587, 0.114));
      color = clamp(mix(vec3(l), color, ${params.value.toFixed(6)}), 0.0, 1.0);
    }`,
    applyToPixel: ([r, g, b], params) => {
      const l = luma(r, g, b);
      const mix = (c) => clamp01((l + (c - l) * params.value) / 255) * 255;
      return [mix(r), mix(g), mix(b)];
    }
  }
};

// src/filters/sepia.ts
function sepiaMatrix(r, g, b) {
  return [
    r * 0.393 + g * 0.769 + b * 0.189,
    r * 0.349 + g * 0.686 + b * 0.168,
    r * 0.272 + g * 0.534 + b * 0.131
  ];
}
var sepiaDefinition = {
  type: "sepia",
  category: "color",
  params: {
    amount: { min: 0, max: 1, default: 1, description: "Blend toward sepia tone, 0 (none) to 1 (full)." }
  },
  op: {
    kind: "color",
    glsl: (params) => `{
      vec3 sepia = vec3(
        dot(color, vec3(0.393, 0.769, 0.189)),
        dot(color, vec3(0.349, 0.686, 0.168)),
        dot(color, vec3(0.272, 0.534, 0.131))
      );
      color = clamp(mix(color, sepia, ${params.amount.toFixed(6)}), 0.0, 1.0);
    }`,
    applyToPixel: ([r, g, b], params) => {
      const [sr, sg, sb] = sepiaMatrix(r, g, b);
      const mix = (c, s) => clamp01((c + (s - c) * params.amount) / 255) * 255;
      return [mix(r, sr), mix(g, sg), mix(b, sb)];
    }
  }
};

// src/filters/temperature.ts
var temperatureDefinition = {
  type: "temperature",
  category: "color",
  params: {
    value: { min: -1, max: 1, default: 0, description: "White-balance shift, -1 (cooler) to 1 (warmer). 0 = no change." }
  },
  op: {
    kind: "color",
    glsl: (params) => {
      const v = params.value * 0.18;
      return `color = clamp(color + vec3(${v.toFixed(6)}, 0.0, ${(-v).toFixed(6)}), 0.0, 1.0);`;
    },
    applyToPixel: ([r, g, b], params) => {
      const shift = params.value * 0.18 * 255;
      return [clamp01((r + shift) / 255) * 255, g, clamp01((b - shift) / 255) * 255];
    }
  }
};

// src/filters/tint.ts
var tintDefinition = {
  type: "tint",
  category: "color",
  params: {
    value: { min: -1, max: 1, default: 0, description: "Green/magenta shift, -1 (green) to 1 (magenta). 0 = no change." }
  },
  op: {
    kind: "color",
    glsl: (params) => {
      const v = params.value * 0.15;
      return `color = clamp(color + vec3(${(v * 0.5).toFixed(6)}, ${(-v).toFixed(6)}, ${(v * 0.5).toFixed(6)}), 0.0, 1.0);`;
    },
    applyToPixel: ([r, g, b], params) => {
      const v = params.value * 0.15 * 255;
      return [clamp01((r + v * 0.5) / 255) * 255, clamp01((g - v) / 255) * 255, clamp01((b + v * 0.5) / 255) * 255];
    }
  }
};

// src/foundations/beauty.ts
var beautySmoothDefinition = {
  type: "beautySmooth",
  category: "spatial",
  params: {
    amount: { min: 0, max: 1, default: 0.4, description: "Whole-frame smoothing strength, 0 (none) to 1 (heavy). Basic blur-based, not face-aware." }
  },
  op: {
    kind: "spatial",
    // Real GLSL work happens in engine/webgl-engine.ts, which maps `amount` to
    // an equivalent blur radius and reuses its separable blur pass — see the
    // module doc there for why blur and beautySmooth share one code path.
    renderGL() {
    },
    applyToImageData(imageData, params) {
      const radius = Math.round((params.amount ?? 0) * 12);
      if (radius <= 0) return;
      boxBlurApprox(imageData, radius);
    }
  }
};
function smooth(params = {}) {
  const merged = { amount: params.amount ?? beautySmoothDefinition.params.amount.default };
  try {
    validateParams(merged, beautySmoothDefinition.params);
  } catch (error) {
    throw error instanceof EffectsError ? error : new EffectsError("RAVEN_EFFECT_INVALID_CONFIG", "Invalid beauty.smooth() config.", error);
  }
  return { type: "beautySmooth", name: "beautySmooth", params: merged };
}
var beauty = { smooth };

// src/filters/index.ts
var FILTER_DEFINITIONS = {
  brightness: brightnessDefinition,
  contrast: contrastDefinition,
  saturation: saturationDefinition,
  exposure: exposureDefinition,
  temperature: temperatureDefinition,
  tint: tintDefinition,
  grayscale: grayscaleDefinition,
  sepia: sepiaDefinition,
  blur: blurDefinition,
  beautySmooth: beautySmoothDefinition
};
function makeFilterFactory(type) {
  const definition = FILTER_DEFINITIONS[type];
  if (!definition) {
    throw new EffectsError("RAVEN_EFFECT_UNSUPPORTED", `Unknown filter type "${type}".`);
  }
  return (params = {}) => {
    const merged = {};
    for (const [name, spec] of Object.entries(definition.params)) {
      merged[name] = params[name] ?? spec.default;
    }
    validateParams(merged, definition.params);
    return { type, name: type, params: merged };
  };
}
var filters = {
  brightness: makeFilterFactory("brightness"),
  contrast: makeFilterFactory("contrast"),
  saturation: makeFilterFactory("saturation"),
  exposure: makeFilterFactory("exposure"),
  temperature: makeFilterFactory("temperature"),
  tint: makeFilterFactory("tint"),
  grayscale: makeFilterFactory("grayscale"),
  sepia: makeFilterFactory("sepia"),
  blur: makeFilterFactory("blur")
};

// src/engine/frame-scheduler.ts
var FrameScheduler = class {
  constructor(video, onFrame) {
    this.stopped = false;
    this.useRvfc = true;
    this.generation = 0;
    this.video = video;
    this.onFrame = onFrame;
  }
  start() {
    this.scheduleNext();
  }
  stop() {
    this.stopped = true;
    this.generation++;
    if (this.watchdog !== void 0) clearTimeout(this.watchdog);
    if (this.handle !== void 0) {
      if (this.useRvfc && this.video.cancelVideoFrameCallback) {
        this.video.cancelVideoFrameCallback(this.handle);
      } else {
        cancelAnimationFrame(this.handle);
      }
    }
  }
  scheduleNext() {
    if (this.stopped) return;
    const gen = this.generation;
    if (this.useRvfc && typeof this.video.requestVideoFrameCallback === "function") {
      this.watchdog = setTimeout(() => {
        if (this.stopped || gen !== this.generation) return;
        this.useRvfc = false;
        this.generation++;
        this.scheduleNext();
      }, 750);
      this.handle = this.video.requestVideoFrameCallback((now) => {
        if (this.stopped || gen !== this.generation) return;
        if (this.watchdog !== void 0) clearTimeout(this.watchdog);
        this.onFrame(now);
        this.scheduleNext();
      });
    } else {
      this.handle = requestAnimationFrame(() => {
        if (this.stopped || gen !== this.generation) return;
        this.onFrame(typeof performance !== "undefined" ? performance.now() : Date.now());
        this.scheduleNext();
      });
    }
  }
};

// src/engine/pixel-ops.ts
function applyColorOpToImageData(imageData, op, params) {
  const { data } = imageData;
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b] = op.applyToPixel([data[i], data[i + 1], data[i + 2]], params);
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
}
var FrameTimer = class {
  constructor(targetFrameRate, windowSize = 60) {
    this.intervals = [];
    this.processingTimes = [];
    this.dropped = 0;
    this.processed = 0;
    this.windowSize = windowSize;
    this.expectedIntervalMs = 1e3 / Math.max(1, targetFrameRate);
  }
  recordFrame(nowMs, processingTimeMs) {
    if (this.lastFrameAt !== void 0) {
      const interval = nowMs - this.lastFrameAt;
      this.push(this.intervals, interval);
      if (interval > this.expectedIntervalMs * 1.5) {
        this.dropped += 1;
      }
    }
    this.lastFrameAt = nowMs;
    this.push(this.processingTimes, processingTimeMs);
    this.processed += 1;
  }
  push(arr, value) {
    arr.push(value);
    if (arr.length > this.windowSize) arr.shift();
  }
  get fps() {
    if (this.intervals.length === 0) return 0;
    const avgInterval = this.intervals.reduce((a, b) => a + b, 0) / this.intervals.length;
    return avgInterval > 0 ? 1e3 / avgInterval : 0;
  }
  get averageFrameTimeMs() {
    if (this.processingTimes.length === 0) return 0;
    return this.processingTimes.reduce((a, b) => a + b, 0) / this.processingTimes.length;
  }
  get droppedFrames() {
    return this.dropped;
  }
  get framesProcessed() {
    return this.processed;
  }
};

// src/engine/canvas2d-engine.ts
var Canvas2DEngine = class {
  constructor(onError) {
    this.kind = "canvas2d";
    this.timer = new FrameTimer(30);
    this.onError = onError;
  }
  start(video, sourceTrack, getEffects) {
    const settings = sourceTrack.getSettings();
    const width = settings.width ?? video.videoWidth ?? 1280;
    const height = settings.height ?? video.videoHeight ?? 720;
    const frameRate = settings.frameRate ?? 30;
    this.timer = new FrameTimer(frameRate);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      throw new EffectsError("RAVEN_EFFECT_UNSUPPORTED", "Canvas 2D context is unavailable in this environment.");
    }
    this.canvas = canvas;
    this.ctx = ctx;
    this.video = video;
    this.getEffects = getEffects;
    const stream = canvas.captureStream(frameRate);
    const [outputTrack] = stream.getVideoTracks();
    this.scheduler = new FrameScheduler(video, (now) => this.runFrame(now));
    this.scheduler.start();
    return outputTrack;
  }
  rebuild() {
  }
  stop() {
    this.scheduler?.stop();
  }
  getStats() {
    return {
      engine: this.kind,
      fps: this.timer.fps,
      averageFrameTimeMs: this.timer.averageFrameTimeMs,
      droppedFrames: this.timer.droppedFrames,
      framesProcessed: this.timer.framesProcessed
    };
  }
  runFrame(now) {
    const start = typeof performance !== "undefined" ? performance.now() : Date.now();
    try {
      this.renderFrame();
    } catch (error) {
      this.onError?.(
        error instanceof EffectsError ? error : new EffectsError("RAVEN_EFFECT_PROCESSING_FAILED", "Canvas2D effect frame failed to render.", error)
      );
    }
    const elapsed = (typeof performance !== "undefined" ? performance.now() : Date.now()) - start;
    this.timer.recordFrame(now, elapsed);
  }
  renderFrame() {
    if (!this.ctx || !this.canvas || !this.video) return;
    this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
    const effects2 = (this.getEffects?.() ?? []).filter((e) => e.enabled);
    if (effects2.length === 0) return;
    const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    for (const effect of effects2) {
      if (effect.op.kind === "color") {
        applyColorOpToImageData(imageData, effect.op, effect.params);
      } else {
        effect.op.applyToImageData(imageData, effect.params);
      }
    }
    this.ctx.putImageData(imageData, 0, 0);
  }
};

// src/engine/passthrough-engine.ts
var PassthroughEngine = class {
  constructor() {
    this.kind = "passthrough";
    this.framesProcessed = 0;
  }
  start(_video, sourceTrack) {
    return sourceTrack;
  }
  rebuild() {
  }
  stop() {
  }
  getStats() {
    return { engine: this.kind, fps: 0, averageFrameTimeMs: 0, droppedFrames: 0, framesProcessed: this.framesProcessed };
  }
};

// src/engine/webgl-engine.ts
var VERTEX_SHADER = `#version 300 es
in vec2 aPosition;
in vec2 aTexCoord;
out vec2 vTexCoord;
void main() {
  vTexCoord = aTexCoord;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;
var IDENTITY_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uTexture;
in vec2 vTexCoord;
out vec4 outColor;
void main() {
  vec3 color = texture(uTexture, vTexCoord).rgb;
  outColor = vec4(color, 1.0);
}`;
var MAX_BLUR_RADIUS = 20;
var BLUR_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uTexture;
uniform vec2 uTexelSize;
uniform vec2 uDirection;
uniform float uWeights[${MAX_BLUR_RADIUS * 2 + 1}];
uniform int uTaps;
in vec2 vTexCoord;
out vec4 outColor;
void main() {
  vec4 sum = vec4(0.0);
  for (int i = -${MAX_BLUR_RADIUS}; i <= ${MAX_BLUR_RADIUS}; i++) {
    if (i < -uTaps || i > uTaps) continue;
    vec2 offset = uDirection * uTexelSize * float(i);
    sum += texture(uTexture, vTexCoord + offset) * uWeights[i + ${MAX_BLUR_RADIUS}];
  }
  outColor = sum;
}`;
function buildColorFragmentShader(effects2) {
  const body = effects2.map((effect) => {
    if (effect.op.kind !== "color") return "";
    return effect.op.glsl(effect.params);
  }).join("\n  ");
  return `#version 300 es
precision highp float;
uniform sampler2D uTexture;
in vec2 vTexCoord;
out vec4 outColor;
void main() {
  vec3 color = texture(uTexture, vTexCoord).rgb;
  ${body}
  outColor = vec4(color, 1.0);
}`;
}
var WebGLEngine = class {
  constructor(onError) {
    this.kind = "webgl2";
    this.passes = [];
    this.colorProgramCache = /* @__PURE__ */ new Map();
    this.width = 0;
    this.height = 0;
    this.timer = new FrameTimer(30);
    this.onError = onError;
  }
  start(video, sourceTrack, getEffects) {
    const settings = sourceTrack.getSettings();
    this.width = settings.width ?? video.videoWidth ?? 1280;
    this.height = settings.height ?? video.videoHeight ?? 720;
    const frameRate = settings.frameRate ?? 30;
    this.timer = new FrameTimer(frameRate);
    const canvas = document.createElement("canvas");
    canvas.width = this.width;
    canvas.height = this.height;
    const gl = canvas.getContext("webgl2");
    if (!gl) {
      throw new EffectsError("RAVEN_EFFECT_UNSUPPORTED", "WebGL2 is unavailable in this environment.");
    }
    this.canvas = canvas;
    this.gl = gl;
    this.video = video;
    this.getEffects = getEffects;
    this.quadBuffer = createQuadBuffer(gl);
    this.inputTexture = createEmptyTexture(gl, this.width, this.height);
    this.pingpong = [createRenderTarget(gl, this.width, this.height), createRenderTarget(gl, this.width, this.height)];
    this.blurProgram = compileProgram(gl, VERTEX_SHADER, BLUR_FRAGMENT);
    this.rebuild();
    const stream = canvas.captureStream(frameRate);
    const [outputTrack] = stream.getVideoTracks();
    this.scheduler = new FrameScheduler(video, (now) => this.runFrame(now));
    this.scheduler.start();
    return outputTrack;
  }
  rebuild() {
    if (!this.gl) return;
    const effects2 = (this.getEffects?.() ?? []).filter((e) => e.enabled);
    this.passes = this.buildPasses(effects2);
  }
  buildPasses(effects2) {
    const gl = this.gl;
    const passes = [];
    let colorRun = [];
    const flushColorRun = () => {
      if (colorRun.length === 0) return;
      const key = colorRun.map((e) => `${e.type}:${JSON.stringify(e.params)}`).join("|");
      let program = this.colorProgramCache.get(key);
      if (!program) {
        program = compileProgram(gl, VERTEX_SHADER, buildColorFragmentShader(colorRun));
        this.colorProgramCache.set(key, program);
      }
      passes.push({ kind: "color", program });
      colorRun = [];
    };
    for (const effect of effects2) {
      if (effect.op.kind === "color") {
        colorRun.push(effect);
        continue;
      }
      flushColorRun();
      const radius = effect.type === "blur" ? effect.params.radius ?? 0 : effect.type === "beautySmooth" ? (effect.params.amount ?? 0) * 12 : 0;
      if (radius > 0) {
        const weights = paddedGaussianWeights(radius);
        const taps = Math.min(MAX_BLUR_RADIUS, Math.ceil(radius));
        passes.push({ kind: "blur", program: this.blurProgram, blurDirection: [1, 0], blurWeights: weights, blurTaps: taps });
        passes.push({ kind: "blur", program: this.blurProgram, blurDirection: [0, 1], blurWeights: weights, blurTaps: taps });
      }
    }
    flushColorRun();
    if (passes.length === 0) {
      let identity = this.colorProgramCache.get("__identity__");
      if (!identity) {
        identity = compileProgram(gl, VERTEX_SHADER, IDENTITY_FRAGMENT);
        this.colorProgramCache.set("__identity__", identity);
      }
      passes.push({ kind: "color", program: identity });
    }
    return passes;
  }
  stop() {
    this.scheduler?.stop();
  }
  getStats() {
    return {
      engine: this.kind,
      fps: this.timer.fps,
      averageFrameTimeMs: this.timer.averageFrameTimeMs,
      droppedFrames: this.timer.droppedFrames,
      framesProcessed: this.timer.framesProcessed
    };
  }
  runFrame(now) {
    const start = typeof performance !== "undefined" ? performance.now() : Date.now();
    try {
      this.renderFrame();
    } catch (error) {
      this.onError?.(
        error instanceof EffectsError ? error : new EffectsError("RAVEN_EFFECT_PROCESSING_FAILED", "WebGL effect frame failed to render.", error)
      );
    }
    const elapsed = (typeof performance !== "undefined" ? performance.now() : Date.now()) - start;
    this.timer.recordFrame(now, elapsed);
  }
  renderFrame() {
    const gl = this.gl;
    if (!gl || !this.video || !this.inputTexture || !this.pingpong || !this.quadBuffer) return;
    gl.bindTexture(gl.TEXTURE_2D, this.inputTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.video);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    let sourceTexture = this.inputTexture;
    for (let i = 0; i < this.passes.length; i++) {
      const isLast = i === this.passes.length - 1;
      const target = isLast ? null : this.pingpong[i % 2];
      this.runPass(this.passes[i], sourceTexture, target);
      sourceTexture = isLast ? sourceTexture : this.pingpong[i % 2].texture;
    }
  }
  runPass(pass, sourceTexture, target) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.framebuffer : null);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(pass.program);
    bindQuad(gl, pass.program, this.quadBuffer);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
    gl.uniform1i(gl.getUniformLocation(pass.program, "uTexture"), 0);
    if (pass.kind === "blur" && pass.blurDirection && pass.blurWeights) {
      gl.uniform2f(gl.getUniformLocation(pass.program, "uTexelSize"), 1 / this.width, 1 / this.height);
      gl.uniform2f(gl.getUniformLocation(pass.program, "uDirection"), pass.blurDirection[0], pass.blurDirection[1]);
      gl.uniform1fv(gl.getUniformLocation(pass.program, "uWeights"), pass.blurWeights);
      gl.uniform1i(gl.getUniformLocation(pass.program, "uTaps"), pass.blurTaps ?? 0);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
};
function paddedGaussianWeights(radius) {
  const raw = gaussianWeights(radius);
  const taps = Math.min(MAX_BLUR_RADIUS, Math.floor(raw.length / 2));
  const padded = new Float32Array(MAX_BLUR_RADIUS * 2 + 1);
  const centerOffset = Math.floor(raw.length / 2);
  for (let k = -taps; k <= taps; k++) {
    padded[MAX_BLUR_RADIUS + k] = raw[centerOffset + k] ?? 0;
  }
  return padded;
}
function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) throw new EffectsError("RAVEN_EFFECT_PROCESSING_FAILED", "Failed to allocate a WebGL shader.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new EffectsError("RAVEN_EFFECT_PROCESSING_FAILED", `Shader failed to compile: ${log ?? "unknown error"}`);
  }
  return shader;
}
function compileProgram(gl, vertexSource, fragmentSource) {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) throw new EffectsError("RAVEN_EFFECT_PROCESSING_FAILED", "Failed to allocate a WebGL program.");
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new EffectsError("RAVEN_EFFECT_PROCESSING_FAILED", `Shader program failed to link: ${log ?? "unknown error"}`);
  }
  return program;
}
function createQuadBuffer(gl) {
  const buffer = gl.createBuffer();
  if (!buffer) throw new EffectsError("RAVEN_EFFECT_PROCESSING_FAILED", "Failed to allocate a WebGL buffer.");
  const vertices = new Float32Array([
    -1,
    -1,
    0,
    0,
    1,
    -1,
    1,
    0,
    -1,
    1,
    0,
    1,
    -1,
    1,
    0,
    1,
    1,
    -1,
    1,
    0,
    1,
    1,
    1,
    1
  ]);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  return buffer;
}
function bindQuad(gl, program, buffer) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  const stride = 4 * Float32Array.BYTES_PER_ELEMENT;
  const positionLoc = gl.getAttribLocation(program, "aPosition");
  if (positionLoc >= 0) {
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, stride, 0);
  }
  const texCoordLoc = gl.getAttribLocation(program, "aTexCoord");
  if (texCoordLoc >= 0) {
    gl.enableVertexAttribArray(texCoordLoc);
    gl.vertexAttribPointer(texCoordLoc, 2, gl.FLOAT, false, stride, 2 * Float32Array.BYTES_PER_ELEMENT);
  }
}
function createEmptyTexture(gl, width, height) {
  const texture = gl.createTexture();
  if (!texture) throw new EffectsError("RAVEN_EFFECT_PROCESSING_FAILED", "Failed to allocate a WebGL texture.");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}
function createRenderTarget(gl, width, height) {
  const texture = createEmptyTexture(gl, width, height);
  const framebuffer = gl.createFramebuffer();
  if (!framebuffer) throw new EffectsError("RAVEN_EFFECT_PROCESSING_FAILED", "Failed to allocate a WebGL framebuffer.");
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { texture, framebuffer };
}

// src/engine/select-engine.ts
function selectEngine(onError, capabilities = detectCapabilities()) {
  switch (capabilities.recommendedEngine) {
    case "webgl2":
      return new WebGLEngine(onError);
    case "canvas2d":
      return new Canvas2DEngine(onError);
    default:
      return new PassthroughEngine();
  }
}

// src/pipeline.ts
var pipelineCounter = 0;
var effectCounter = 0;
var EffectsPipeline = class extends TypedEventEmitter {
  constructor() {
    super();
    this._isEnabled = true;
    this._effects = [];
    this.customRegistrations = /* @__PURE__ */ new Map();
    this.id = `effects_${++pipelineCounter}`;
  }
  get effects() {
    return this._effects;
  }
  get isEnabled() {
    return this._isEnabled;
  }
  /** Adds a filter (from `raven.effects.filters.*`) or preset entry to the end of the pipeline. */
  add(config) {
    assertPipelineNotFull(this._effects.length);
    const definition = FILTER_DEFINITIONS[config.type];
    if (!definition) {
      throw new EffectsError("RAVEN_EFFECT_UNSUPPORTED", `Unknown filter type "${config.type}".`);
    }
    validateParams(config.params, definition.params);
    const instance = {
      id: `effect_${++effectCounter}`,
      type: config.type,
      name: config.name,
      enabled: true,
      params: { ...config.params },
      op: definition.op
    };
    this._effects.push(instance);
    this.engine?.rebuild();
    this.emit("effectAdded", instance);
    return instance;
  }
  /**
   * Registers a trusted, in-process custom effect (Phase 16 §19). Raven
   * Effects never loads effects from a URL or executes untrusted code —
   * `effect` must already be a real object in the host application's own
   * bundle. See security.ts.
   */
  addCustomEffect(effect, initialParams = {}) {
    assertPipelineNotFull(this._effects.length);
    validateParams(initialParams, effect.parameters);
    const merged = {};
    for (const [name, spec] of Object.entries(effect.parameters)) {
      merged[name] = initialParams[name] ?? spec.default;
    }
    const op = effect.process(merged);
    const instance = {
      id: `effect_${++effectCounter}`,
      type: `custom:${effect.id}`,
      name: effect.name,
      enabled: true,
      params: merged,
      op
    };
    this.customRegistrations.set(instance.id, { effect, params: merged });
    this._effects.push(instance);
    this.engine?.rebuild();
    this.emit("effectAdded", instance);
    return instance;
  }
  /** Adds every filter in a preset (e.g. `raven.effects.presets.cinematic()`), in order. */
  applyPreset(preset) {
    return preset().map((config) => this.add(config));
  }
  remove(effectOrId) {
    const id = typeof effectOrId === "string" ? effectOrId : effectOrId.id;
    const index = this._effects.findIndex((e) => e.id === id);
    if (index === -1) return;
    const registration = this.customRegistrations.get(id);
    if (registration) {
      void registration.effect.destroy();
      this.customRegistrations.delete(id);
    }
    this._effects.splice(index, 1);
    this.engine?.rebuild();
    this.emit("effectRemoved", id);
  }
  /** Updates one effect's parameters (partial merge) — e.g. `effects.update(id, { value: 0.5 })`. */
  update(effectId, params) {
    const instance = this.require(effectId);
    const registration = this.customRegistrations.get(effectId);
    const specs = registration ? registration.effect.parameters : FILTER_DEFINITIONS[instance.type]?.params;
    const merged = { ...instance.params };
    for (const [name, value] of Object.entries(params)) {
      if (value !== void 0) merged[name] = value;
    }
    if (specs) validateParams(merged, specs);
    instance.params = merged;
    if (registration) {
      registration.effect.update(merged);
      instance.op = registration.effect.process(merged);
      registration.params = merged;
    }
    this.engine?.rebuild();
    this.emit("effectUpdated", instance);
  }
  /** Moves an effect to a new index in the chain — order matters for how effects compose. */
  reorder(effectId, toIndex) {
    const fromIndex = this._effects.findIndex((e) => e.id === effectId);
    if (fromIndex === -1) return;
    const [instance] = this._effects.splice(fromIndex, 1);
    const clampedIndex = Math.max(0, Math.min(toIndex, this._effects.length));
    this._effects.splice(clampedIndex, 0, instance);
    this.engine?.rebuild();
    this.emit(
      "reordered",
      this._effects.map((e) => e.id)
    );
  }
  /** With no id: enables the whole pipeline (bypass off). With an id: enables just that effect. */
  enable(effectId) {
    if (effectId) {
      this.require(effectId).enabled = true;
      this.engine?.rebuild();
    } else {
      this._isEnabled = true;
    }
    this.emit("enabled", effectId);
  }
  /** With no id: disables the whole pipeline (camera publishes unmodified). With an id: disables just that effect. */
  disable(effectId) {
    if (effectId) {
      this.require(effectId).enabled = false;
      this.engine?.rebuild();
    } else {
      this._isEnabled = false;
    }
    this.emit("disabled", effectId);
  }
  clear() {
    for (const id of this.customRegistrations.keys()) {
      void this.customRegistrations.get(id)?.effect.destroy();
    }
    this.customRegistrations.clear();
    this._effects = [];
    this.engine?.rebuild();
    this.emit("cleared");
  }
  require(effectId) {
    const instance = this._effects.find((e) => e.id === effectId);
    if (!instance) {
      throw new EffectsError("RAVEN_EFFECT_INVALID_CONFIG", `No effect with id "${effectId}" in this pipeline.`);
    }
    return instance;
  }
  /**
   * @internal Called by `@corvidhq/rtc`'s `LocalTrack.attachEffects()` —
   * not part of the public surface a developer calls directly. Starts
   * processing `sourceTrack` and returns the live output track to publish.
   */
  async attachToTrack(sourceTrack, engineOverride) {
    if (this.engine) {
      throw new EffectsError("RAVEN_EFFECT_INVALID_CONFIG", "This pipeline is already attached to a track. Detach it first.");
    }
    if (!hasDocument()) {
      this.emit(
        "error",
        new EffectsError("RAVEN_EFFECT_UNSUPPORTED", "Raven Effects has no DOM to render into in this environment \u2014 the camera track is unmodified.")
      );
      return sourceTrack;
    }
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("aria-hidden", "true");
    video.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:2px;height:2px;opacity:0;pointer-events:none;";
    document.body.appendChild(video);
    try {
      video.srcObject = new MediaStream([sourceTrack]);
      const playResult = video.play();
      if (playResult && typeof playResult.catch === "function") {
        await playResult.catch(() => {
        });
      }
    } catch (error) {
      video.remove();
      this.emit(
        "error",
        error instanceof EffectsError ? error : new EffectsError("RAVEN_EFFECT_UNSUPPORTED", "Could not attach the source track to a video element.", error)
      );
      return sourceTrack;
    }
    this.engine = engineOverride ?? selectEngine((error) => this.emit("error", error), detectCapabilities());
    this.videoEl = video;
    try {
      const outputTrack = this.engine.start(video, sourceTrack, () => this._isEnabled ? this._effects : []);
      this.startStatsTimer();
      return outputTrack;
    } catch (error) {
      this.engine = void 0;
      video.remove();
      this.videoEl = void 0;
      const effectsError = error instanceof EffectsError ? error : new EffectsError("RAVEN_EFFECT_PROCESSING_FAILED", "Failed to start effects engine.", error);
      this.emit("error", effectsError);
      return sourceTrack;
    }
  }
  /** @internal Stops processing and releases engine resources. */
  detach() {
    this.stopStatsTimer();
    this.engine?.stop();
    this.engine = void 0;
    if (this.videoEl) {
      this.videoEl.srcObject = null;
      this.videoEl.remove();
      this.videoEl = void 0;
    }
  }
  get engineKind() {
    return this.engine?.kind;
  }
  getStats() {
    return this.engine?.getStats();
  }
  startStatsTimer() {
    this.statsTimer = setInterval(() => {
      const stats = this.engine?.getStats();
      if (stats) this.emit("stats", stats);
    }, 2e3);
  }
  stopStatsTimer() {
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = void 0;
    }
  }
};
function createEffectsPipeline() {
  return new EffectsPipeline();
}

// src/presets.ts
var vivid = () => [
  filters.saturation({ value: 1.4 }),
  filters.contrast({ value: 0.15 }),
  filters.brightness({ value: 0.03 })
];
var warm = () => [filters.temperature({ value: 0.35 }), filters.tint({ value: 0.05 }), filters.saturation({ value: 1.1 })];
var cool = () => [filters.temperature({ value: -0.35 }), filters.saturation({ value: 1.05 })];
var cinematic = () => [
  filters.contrast({ value: 0.2 }),
  filters.saturation({ value: 0.85 }),
  filters.temperature({ value: 0.1 })
];
var vintage = () => [
  filters.sepia({ amount: 0.35 }),
  filters.contrast({ value: -0.1 }),
  filters.saturation({ value: 0.7 }),
  filters.brightness({ value: 0.02 })
];
var presets = { vivid, warm, cool, cinematic, vintage };

// src/foundations/face-detector.ts
var UnsupportedFaceDetector = class {
  isSupported() {
    return false;
  }
  async detect() {
    throw new EffectsError(
      "RAVEN_EFFECT_UNSUPPORTED",
      "Face detection is planned but not implemented in this Raven Effects release. isSupported() reports this \u2014 check it before calling detect()."
    );
  }
  onFacesChanged() {
    return () => {
    };
  }
};
function createFaceDetector() {
  return new UnsupportedFaceDetector();
}

// src/foundations/background.ts
var UnsupportedBackgroundProcessor = class {
  isSupported() {
    return false;
  }
  configure() {
    throw new EffectsError(
      "RAVEN_EFFECT_UNSUPPORTED",
      "Background blur/replacement is planned but not implemented in this Raven Effects release \u2014 it requires a segmentation model this release does not ship."
    );
  }
};
function createBackgroundProcessor() {
  return new UnsupportedBackgroundProcessor();
}

// src/foundations/ar.ts
var UnsupportedAROverlay = class {
  constructor(faceDetector) {
    this.faceDetector = faceDetector;
  }
  isSupported() {
    return this.faceDetector.isSupported();
  }
  attach() {
    throw new EffectsError(
      "RAVEN_EFFECT_UNSUPPORTED",
      "AR overlays are planned but not implemented in this Raven Effects release \u2014 they require face tracking, which this release does not ship."
    );
  }
  detach() {
  }
};
function createAROverlay(faceDetector) {
  return new UnsupportedAROverlay(faceDetector);
}

// src/index.ts
var effects = {
  createPipeline: createEffectsPipeline,
  filters,
  presets,
  beauty,
  createFaceDetector,
  createBackgroundProcessor,
  createAROverlay,
  detectCapabilities
};

export { EFFECT_SECURITY_LIMITS, EffectsError, EffectsPipeline, FILTER_DEFINITIONS, beauty, createAROverlay, createBackgroundProcessor, createEffectsPipeline, createFaceDetector, detectCapabilities, effects, filters, isEffectsError, presets, validateAsset, validateParam, validateParams };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map