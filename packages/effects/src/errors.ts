/**
 * Stable typed error codes Livqeno Effects raises. Never a raw DOMException
 * or WebGL error. @ravenkash/rtc's RTCError is the sibling convention this
 * mirrors.
 */
export type EffectsErrorCode =
  | 'RAVEN_EFFECT_UNSUPPORTED'
  | 'RAVEN_EFFECT_INVALID_CONFIG'
  | 'RAVEN_EFFECT_PROCESSING_FAILED'
  | 'RAVEN_EFFECT_PERMISSION_DENIED'
  | 'RAVEN_EFFECT_RESOURCE_LIMIT';

/** The only error type Livqeno Effects throws, or emits on the `error` event. */
export class EffectsError extends Error {
  readonly code: EffectsErrorCode;
  readonly cause?: unknown;

  constructor(code: EffectsErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'EffectsError';
    this.code = code;
    this.cause = cause;
  }
}

export function isEffectsError(value: unknown): value is EffectsError {
  return value instanceof EffectsError;
}
