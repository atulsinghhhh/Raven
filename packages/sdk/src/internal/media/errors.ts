import { RTCError } from '../../errors';
import type { TrackKind } from '../../track';

/**
 * Maps a raw getUserMedia/getDisplayMedia failure to one of our typed
 * error codes.
 *
 * The classification is a short read of the `DOMException` names the
 * Media Capture spec defines, so Raven owns it rather than depending on a
 * library for it.
 *
 * The names come from the spec's error list (getUserMedia §9.2), not from
 * any browser's particulars — every engine reports these, and a name we
 * do not recognise falls through to a generic `MEDIA_ERROR` rather than
 * being guessed at.
 */
export function toMediaError(error: unknown, kind: TrackKind): RTCError {
  const name = errorName(error);

  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      // SecurityError is what a browser raises when the page is not a
      // secure context. It is a permission problem from the developer's
      // point of view, and the message says which kind.
      return new RTCError(
        permissionDeniedCode(kind),
        `Permission to use the ${label(kind)} was denied`,
        error,
      );

    case 'NotFoundError':
    case 'OverconstrainedError':
      // OverconstrainedError means no device satisfies the constraints —
      // in practice a deviceId that no longer exists, which is the same
      // situation a developer needs to handle as "not found".
      return new RTCError('DEVICE_NOT_FOUND', `No ${label(kind)} device matched`, error);

    case 'NotReadableError':
      return new RTCError(
        'MEDIA_ERROR',
        `The ${label(kind)} is already in use by another application`,
        error,
      );

    case 'AbortError':
      return new RTCError('MEDIA_ERROR', `Capturing the ${label(kind)} was aborted`, error);

    case 'TypeError':
      // Empty or malformed constraints. A programming error rather than a
      // device one, so say so.
      return new RTCError('MEDIA_ERROR', `Invalid ${label(kind)} capture constraints`, error);

    default:
      return new RTCError('MEDIA_ERROR', `Could not access the ${label(kind)}`, error);
  }
}

function errorName(error: unknown): string | undefined {
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    return error.name;
  }
  // Not every environment exposes DOMException (some test runners, older
  // React Native), and `error.name` is present either way.
  if (error && typeof error === 'object' && typeof (error as { name?: unknown }).name === 'string') {
    return (error as { name: string }).name;
  }
  return undefined;
}

/** What a developer calls the thing, rather than what the SDK calls it internally. */
function label(kind: TrackKind): string {
  return kind === 'screenShare' ? 'screen' : kind;
}

function permissionDeniedCode(
  kind: TrackKind,
): 'CAMERA_PERMISSION_DENIED' | 'MICROPHONE_PERMISSION_DENIED' | 'PERMISSION_DENIED' {
  if (kind === 'camera') return 'CAMERA_PERMISSION_DENIED';
  if (kind === 'microphone') return 'MICROPHONE_PERMISSION_DENIED';
  return 'PERMISSION_DENIED';
}
