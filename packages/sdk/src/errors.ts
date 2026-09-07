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
  /**
   * The platform cannot do this at all — e.g. screen sharing on a mobile
   * browser with no `getDisplayMedia`.
   *
   * Added in the native-RTC release, and deliberately distinct from
   * `MEDIA_ERROR`: "this device has no such capability" is a permanent
   * fact a UI should reflect by hiding the button, while `MEDIA_ERROR`
   * is a failure worth retrying. Spec §16 requires the two be
   * distinguishable. Purely additive — no existing code changed meaning.
   */
  | 'NOT_SUPPORTED'
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
