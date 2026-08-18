/** Stable, typed error codes the SDK can raise. Never a raw browser/DOMException. */
export type RTCErrorCode =
  | 'INVALID_TOKEN'
  | 'TOKEN_EXPIRED'
  | 'ROOM_NOT_FOUND'
  | 'CONNECTION_FAILED'
  | 'PERMISSION_DENIED'
  | 'CAMERA_PERMISSION_DENIED'
  | 'MICROPHONE_PERMISSION_DENIED'
  | 'DEVICE_NOT_FOUND'
  | 'NETWORK_ERROR'
  | 'SIGNALING_ERROR'
  | 'MEDIA_ERROR'
  | 'TIMEOUT';

/** The one error type this SDK throws or emits on the `error` event. */
export class RTCError extends Error {
  readonly code: RTCErrorCode;
  readonly cause?: unknown;

  constructor(code: RTCErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'RTCError';
    this.code = code;
    this.cause = cause;
  }
}

export function isRTCError(value: unknown): value is RTCError {
  return value instanceof RTCError;
}
