export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** Rec. 601 luma — matches the GLSL `dot(color, vec3(0.299, 0.587, 0.114))` used by the shader engine. */
export function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}
