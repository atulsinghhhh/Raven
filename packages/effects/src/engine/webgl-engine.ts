import { EffectsError } from '../errors';
import { FrameScheduler } from './frame-scheduler';
import { gaussianWeights } from '../filters/blur';
import type { EffectInstance } from '../types';
import { FrameTimer } from './pixel-ops';
import type { EffectsEngine, PipelineStats } from './types';

const VERTEX_SHADER = `#version 300 es
in vec2 aPosition;
in vec2 aTexCoord;
out vec2 vTexCoord;
void main() {
  vTexCoord = aTexCoord;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const IDENTITY_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uTexture;
in vec2 vTexCoord;
out vec4 outColor;
void main() {
  vec3 color = texture(uTexture, vTexCoord).rgb;
  outColor = vec4(color, 1.0);
}`;

const MAX_BLUR_RADIUS = 20;
const BLUR_FRAGMENT = `#version 300 es
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

function buildColorFragmentShader(effects: EffectInstance[]): string {
  const body = effects
    .map((effect) => {
      if (effect.op.kind !== 'color') return '';
      return effect.op.glsl(effect.params);
    })
    .join('\n  ');
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

interface Pass {
  kind: 'color' | 'blur';
  program: WebGLProgram;
  blurDirection?: [number, number];
  blurWeights?: Float32Array;
  blurTaps?: number;
}

interface RenderTarget {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
}

/**
 * Real multi-pass WebGL2 pipeline: consecutive per-pixel color adjustments
 * are folded into one compiled shader pass; blur gets its own separable
 * (horizontal + vertical) pass. Passes ping-pong between two offscreen
 * render targets, with the final pass drawing straight to the canvas that
 * backs the published `MediaStreamTrack` (via `captureStream`) — no extra
 * copy after that.
 */
export class WebGLEngine implements EffectsEngine {
  readonly kind = 'webgl2' as const;
  private canvas?: HTMLCanvasElement;
  private gl?: WebGL2RenderingContext;
  private video?: HTMLVideoElement;
  private getEffects?: () => EffectInstance[];
  private scheduler?: FrameScheduler;
  private timer: FrameTimer;
  private onError?: (error: EffectsError) => void;

  private quadBuffer?: WebGLBuffer;
  private inputTexture?: WebGLTexture;
  private pingpong: [RenderTarget, RenderTarget] | undefined;
  private passes: Pass[] = [];
  private colorProgramCache = new Map<string, WebGLProgram>();
  private blurProgram?: WebGLProgram;
  private width = 0;
  private height = 0;

  constructor(onError?: (error: EffectsError) => void) {
    this.timer = new FrameTimer(30);
    this.onError = onError;
  }

  start(video: HTMLVideoElement, sourceTrack: MediaStreamTrack, getEffects: () => EffectInstance[]): MediaStreamTrack {
    const settings = sourceTrack.getSettings();
    this.width = settings.width ?? video.videoWidth ?? 1280;
    this.height = settings.height ?? video.videoHeight ?? 720;
    const frameRate = settings.frameRate ?? 30;
    this.timer = new FrameTimer(frameRate);

    const canvas = document.createElement('canvas');
    canvas.width = this.width;
    canvas.height = this.height;
    const gl = canvas.getContext('webgl2');
    if (!gl) {
      throw new EffectsError('RAVEN_EFFECT_UNSUPPORTED', 'WebGL2 is unavailable in this environment.');
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

  rebuild(): void {
    if (!this.gl) return;
    const effects = (this.getEffects?.() ?? []).filter((e) => e.enabled);
    this.passes = this.buildPasses(effects);
  }

  private buildPasses(effects: EffectInstance[]): Pass[] {
    const gl = this.gl!;
    const passes: Pass[] = [];
    let colorRun: EffectInstance[] = [];

    const flushColorRun = () => {
      if (colorRun.length === 0) return;
      const key = colorRun.map((e) => `${e.type}:${JSON.stringify(e.params)}`).join('|');
      let program = this.colorProgramCache.get(key);
      if (!program) {
        program = compileProgram(gl, VERTEX_SHADER, buildColorFragmentShader(colorRun));
        this.colorProgramCache.set(key, program);
      }
      passes.push({ kind: 'color', program });
      colorRun = [];
    };

    for (const effect of effects) {
      if (effect.op.kind === 'color') {
        colorRun.push(effect);
        continue;
      }
      flushColorRun();
      const radius = effect.type === 'blur' ? (effect.params.radius ?? 0) : effect.type === 'beautySmooth' ? (effect.params.amount ?? 0) * 12 : 0;
      if (radius > 0) {
        const weights = paddedGaussianWeights(radius);
        const taps = Math.min(MAX_BLUR_RADIUS, Math.ceil(radius));
        passes.push({ kind: 'blur', program: this.blurProgram!, blurDirection: [1, 0], blurWeights: weights, blurTaps: taps });
        passes.push({ kind: 'blur', program: this.blurProgram!, blurDirection: [0, 1], blurWeights: weights, blurTaps: taps });
      }
    }
    flushColorRun();

    if (passes.length === 0) {
      let identity = this.colorProgramCache.get('__identity__');
      if (!identity) {
        identity = compileProgram(gl, VERTEX_SHADER, IDENTITY_FRAGMENT);
        this.colorProgramCache.set('__identity__', identity);
      }
      passes.push({ kind: 'color', program: identity });
    }
    return passes;
  }

  stop(): void {
    this.scheduler?.stop();
  }

  getStats(): PipelineStats {
    return {
      engine: this.kind,
      fps: this.timer.fps,
      averageFrameTimeMs: this.timer.averageFrameTimeMs,
      droppedFrames: this.timer.droppedFrames,
      framesProcessed: this.timer.framesProcessed,
    };
  }

  private runFrame(now: number): void {
    const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
    try {
      this.renderFrame();
    } catch (error) {
      this.onError?.(
        error instanceof EffectsError
          ? error
          : new EffectsError('RAVEN_EFFECT_PROCESSING_FAILED', 'WebGL effect frame failed to render.', error),
      );
    }
    const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - start;
    this.timer.recordFrame(now, elapsed);
  }

  private renderFrame(): void {
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

  private runPass(pass: Pass, sourceTexture: WebGLTexture, target: RenderTarget | null): void {
    const gl = this.gl!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.framebuffer : null);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(pass.program);
    bindQuad(gl, pass.program, this.quadBuffer!);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
    gl.uniform1i(gl.getUniformLocation(pass.program, 'uTexture'), 0);

    if (pass.kind === 'blur' && pass.blurDirection && pass.blurWeights) {
      gl.uniform2f(gl.getUniformLocation(pass.program, 'uTexelSize'), 1 / this.width, 1 / this.height);
      gl.uniform2f(gl.getUniformLocation(pass.program, 'uDirection'), pass.blurDirection[0], pass.blurDirection[1]);
      gl.uniform1fv(gl.getUniformLocation(pass.program, 'uWeights'), pass.blurWeights);
      gl.uniform1i(gl.getUniformLocation(pass.program, 'uTaps'), pass.blurTaps ?? 0);
    }

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}

function paddedGaussianWeights(radius: number): Float32Array {
  const raw = gaussianWeights(radius);
  const taps = Math.min(MAX_BLUR_RADIUS, Math.floor(raw.length / 2));
  const padded = new Float32Array(MAX_BLUR_RADIUS * 2 + 1);
  const centerOffset = Math.floor(raw.length / 2);
  for (let k = -taps; k <= taps; k++) {
    padded[MAX_BLUR_RADIUS + k] = raw[centerOffset + k] ?? 0;
  }
  return padded;
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new EffectsError('RAVEN_EFFECT_PROCESSING_FAILED', 'Failed to allocate a WebGL shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new EffectsError('RAVEN_EFFECT_PROCESSING_FAILED', `Shader failed to compile: ${log ?? 'unknown error'}`);
  }
  return shader;
}

function compileProgram(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string): WebGLProgram {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) throw new EffectsError('RAVEN_EFFECT_PROCESSING_FAILED', 'Failed to allocate a WebGL program.');
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new EffectsError('RAVEN_EFFECT_PROCESSING_FAILED', `Shader program failed to link: ${log ?? 'unknown error'}`);
  }
  return program;
}

// Two triangles covering clip space, with matching [0,1] texcoords.
function createQuadBuffer(gl: WebGL2RenderingContext): WebGLBuffer {
  const buffer = gl.createBuffer();
  if (!buffer) throw new EffectsError('RAVEN_EFFECT_PROCESSING_FAILED', 'Failed to allocate a WebGL buffer.');
  // x, y, u, v
  const vertices = new Float32Array([
    -1, -1, 0, 0,
    1, -1, 1, 0,
    -1, 1, 0, 1,
    -1, 1, 0, 1,
    1, -1, 1, 0,
    1, 1, 1, 1,
  ]);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  return buffer;
}

function bindQuad(gl: WebGL2RenderingContext, program: WebGLProgram, buffer: WebGLBuffer): void {
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  const stride = 4 * Float32Array.BYTES_PER_ELEMENT;
  const positionLoc = gl.getAttribLocation(program, 'aPosition');
  if (positionLoc >= 0) {
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, stride, 0);
  }
  const texCoordLoc = gl.getAttribLocation(program, 'aTexCoord');
  if (texCoordLoc >= 0) {
    gl.enableVertexAttribArray(texCoordLoc);
    gl.vertexAttribPointer(texCoordLoc, 2, gl.FLOAT, false, stride, 2 * Float32Array.BYTES_PER_ELEMENT);
  }
}

function createEmptyTexture(gl: WebGL2RenderingContext, width: number, height: number): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new EffectsError('RAVEN_EFFECT_PROCESSING_FAILED', 'Failed to allocate a WebGL texture.');
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

function createRenderTarget(gl: WebGL2RenderingContext, width: number, height: number): RenderTarget {
  const texture = createEmptyTexture(gl, width, height);
  const framebuffer = gl.createFramebuffer();
  if (!framebuffer) throw new EffectsError('RAVEN_EFFECT_PROCESSING_FAILED', 'Failed to allocate a WebGL framebuffer.');
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { texture, framebuffer };
}
