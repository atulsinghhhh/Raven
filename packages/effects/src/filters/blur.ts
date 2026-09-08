import type { EffectDefinition, SpatialOp } from '../types';

/**
 * Gaussian blur. A spatial op, so it gets its own render pass; see
 * engine/webgl-engine.ts.
 *
 * `radius`: 0 (unchanged) to 20 pixels, at the frame's native resolution.
 */
function gaussianWeights(radius: number): number[] {
  const sigma = Math.max(radius / 2, 0.0001);
  const taps = Math.max(1, Math.ceil(radius));
  const weights: number[] = [];
  for (let i = -taps; i <= taps; i++) {
    weights.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
  }
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => w / sum);
}

const blurOp: SpatialOp = {
  kind: 'spatial',
  renderGL(gl, source, target, width, height, params) {
    // The real separable-blur wiring lives in engine/webgl-engine.ts, which
    // owns the shared blur program and framebuffers needed to ping-pong the
    // horizontal and vertical passes. This hook exists purely to keep the
    // pipeline's op list engine-agnostic; the WebGL engine special-cases
    // `type === 'blur'` when it builds its pass list.
    void gl;
    void source;
    void target;
    void width;
    void height;
    void params;
  },
  applyToImageData(imageData, params) {
    const radius = Math.round(params.radius);
    if (radius <= 0) return;
    boxBlurApprox(imageData, radius);
  },
};

/** Three-pass box blur. The standard fast approximation of Gaussian blur, for the CPU fallback path. */
function boxBlurApprox(imageData: ImageData, radius: number): void {
  const { width, height, data } = imageData;
  const passes = 3;
  for (let p = 0; p < passes; p++) {
    horizontalPass(data, width, height, radius);
    verticalPass(data, width, height, radius);
  }
}

function horizontalPass(data: Uint8ClampedArray, width: number, height: number, radius: number): void {
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
        const idx = (y * width + sx) * 4;
        r += copy[idx];
        g += copy[idx + 1];
        b += copy[idx + 2];
        a += copy[idx + 3];
      }
      const idx = (y * width + x) * 4;
      data[idx] = r / windowSize;
      data[idx + 1] = g / windowSize;
      data[idx + 2] = b / windowSize;
      data[idx + 3] = a / windowSize;
    }
  }
}

function verticalPass(data: Uint8ClampedArray, width: number, height: number, radius: number): void {
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
        const idx = (sy * width + x) * 4;
        r += copy[idx];
        g += copy[idx + 1];
        b += copy[idx + 2];
        a += copy[idx + 3];
      }
      const idx = (y * width + x) * 4;
      data[idx] = r / windowSize;
      data[idx + 1] = g / windowSize;
      data[idx + 2] = b / windowSize;
      data[idx + 3] = a / windowSize;
    }
  }
}

export const blurDefinition: EffectDefinition = {
  type: 'blur',
  category: 'spatial',
  params: {
    radius: { min: 0, max: 20, default: 6, description: 'Blur radius in pixels, 0 (none) to 20.' },
  },
  op: blurOp,
};

export { gaussianWeights, boxBlurApprox };
