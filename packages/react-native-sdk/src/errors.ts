import { RTCError, type RTCErrorCode } from '@raven/rtc';

/**
 * Mobile adds exactly one failure mode the web SDK doesn't have: an
 * operating system that can refuse camera or microphone access outright,
 * permanently, with no way for the app to ask again.
 *
 * Everything else — expired tokens, failed connections, missing rooms,
 * unavailable devices — already has a code in `@raven/rtc`, and reusing
 * those is the point. A developer moving from web to mobile should be
 * catching the same `RTCError` with the same `code`, not learning a
 * parallel error vocabulary (Phase 13 spec §14).
 *
 * So this file adds a subclass with extra mobile-specific context, not a
 * new hierarchy: `RavenPermissionError` *is* an `RTCError`, and existing
 * `catch (e) { if (isRTCError(e)) ... }` code keeps working unchanged.
 */
export type RavenPermissionKind = 'camera' | 'microphone';

/** What the OS said, normalised across iOS and Android. */
export type RavenPermissionStatus =
  | 'granted'
  /** Refused this time. Asking again may still prompt. */
  | 'denied'
  /**
   * Refused permanently — Android's "don't ask again", or iOS after any
   * refusal. Prompting again does nothing; the user has to change it in
   * Settings, and your UI needs to say so.
   */
  | 'blocked'
  /** Not determined yet — no prompt has been shown. */
  | 'undetermined'
  /** The platform doesn't gate this permission (or we can't tell). */
  | 'unavailable';

/**
 * Thrown when the OS denies camera or microphone access.
 *
 * Carries `blocked` because the correct UI differs sharply: a plain
 * denial can be retried with another prompt, while a blocked one must
 * send the user to Settings. Silently failing here — the thing §3 of the
 * spec explicitly forbids — is how apps end up showing a black rectangle
 * with no explanation.
 */
export class RavenPermissionError extends RTCError {
  readonly permission: RavenPermissionKind;
  readonly status: RavenPermissionStatus;

  constructor(permission: RavenPermissionKind, status: RavenPermissionStatus, cause?: unknown) {
    super(
      permission === 'camera' ? 'CAMERA_PERMISSION_DENIED' : 'MICROPHONE_PERMISSION_DENIED',
      status === 'blocked'
        ? `${permission} access is blocked. The user must enable it in the system settings — prompting again will not show a dialog.`
        : `${permission} access was denied.`,
      cause,
    );
    this.name = 'RavenPermissionError';
    this.permission = permission;
    this.status = status;
  }

  /** True when re-prompting is pointless and only Settings will help. */
  get requiresSettings(): boolean {
    return this.status === 'blocked';
  }
}

export function isRavenPermissionError(value: unknown): value is RavenPermissionError {
  return value instanceof RavenPermissionError;
}

/**
 * Maps a `getUserMedia` rejection to a permission error where that's what
 * it really was.
 *
 * iOS gives no permissions API to React Native without a native module,
 * so a denied camera surfaces only as a `getUserMedia` failure. Reading
 * the DOMException name is how we turn that into something a developer
 * can branch on.
 */
export function toPermissionError(
  permission: RavenPermissionKind,
  error: unknown,
): RavenPermissionError | undefined {
  const name = (error as { name?: string } | undefined)?.name;
  const message = String((error as { message?: string } | undefined)?.message ?? '');

  const denied =
    name === 'NotAllowedError' ||
    name === 'SecurityError' ||
    /permission|denied|not allowed/i.test(message);

  return denied ? new RavenPermissionError(permission, 'denied', error) : undefined;
}

// Re-exported so a mobile app can catch everything Raven throws without
// also importing @raven/rtc directly.
export { RTCError, isRTCError } from '@raven/rtc';
export type { RTCErrorCode };
