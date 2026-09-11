/** Stable typed error codes the SDK raises. Never a raw browser DOMException. */
export type RTCErrorCode =
  | 'INVALID_TOKEN'
  | 'TOKEN_EXPIRED'
  /**
   * The token was revoked before it expired. Distinct from `TOKEN_EXPIRED`
   * because the cause is deliberate rather than the clock, and a UI may
   * well want to say something different: "this session was ended" rather
   * than "your session timed out".
   */
  | 'TOKEN_REVOKED'
  /**
   * The account behind this project has spent its included Livqeno minutes.
   *
   * Its own code rather than `SIGNALING_ERROR` because it is the one join
   * failure whose remedy is commercial, not technical: no retry, no fresh
   * token and no code change fixes it, so an application wants to show a
   * billing prompt instead of a "try again" button. Sessions already in
   * progress are never cut off by it.
   */
  | 'USAGE_LIMIT_EXCEEDED'
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
   * The platform simply can't do this. Screen sharing on a mobile browser
   * with no `getDisplayMedia`, say.
   *
   * Added in the native-RTC release, and kept separate from `MEDIA_ERROR`
   * on purpose. "This device has no such capability" is a permanent fact a
   * UI should act on by hiding the button; `MEDIA_ERROR` is a failure worth
   * retrying. Spec §16 requires telling the two apart. Purely additive, so
   * no existing code changed meaning.
   */
  | 'NOT_SUPPORTED'
  | 'TIMEOUT';

/** The only error type this SDK throws, or emits on the `error` event. */
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
