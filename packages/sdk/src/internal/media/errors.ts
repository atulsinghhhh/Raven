import { MediaDeviceFailure } from 'livekit-client';
import { RTCError } from '../../errors';
import type { TrackKind } from '../../track';

/**
 * Maps a raw getUserMedia/getDisplayMedia failure to one of our typed
 * error codes — reuses livekit-client's own DOMException classifier
 * instead of re-deriving `error.name` checks ourselves.
 */
export function toMediaError(error: unknown, kind: TrackKind): RTCError {
  const failure = MediaDeviceFailure.getFailure(error);

  switch (failure) {
    case MediaDeviceFailure.PermissionDenied:
      return new RTCError(permissionDeniedCode(kind), `Permission to use the ${kind} was denied`, error);
    case MediaDeviceFailure.NotFound:
      return new RTCError('DEVICE_NOT_FOUND', `No ${kind} device was found`, error);
    case MediaDeviceFailure.DeviceInUse:
      return new RTCError('MEDIA_ERROR', `The ${kind} device is already in use by another application`, error);
    default:
      return new RTCError('MEDIA_ERROR', `Could not access the ${kind}`, error);
  }
}

function permissionDeniedCode(kind: TrackKind): 'CAMERA_PERMISSION_DENIED' | 'MICROPHONE_PERMISSION_DENIED' | 'PERMISSION_DENIED' {
  if (kind === 'camera') return 'CAMERA_PERMISSION_DENIED';
  if (kind === 'microphone') return 'MICROPHONE_PERMISSION_DENIED';
  return 'PERMISSION_DENIED';
}
