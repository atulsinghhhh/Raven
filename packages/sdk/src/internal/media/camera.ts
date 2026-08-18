import { createLocalVideoTrack } from 'livekit-client';
import { LocalTrack } from '../../track';
import { toMediaError } from './errors';

/**
 * Captures a camera track without publishing it — for callers who want a
 * preview before `room.publish(track)`. `room.enableCamera()` skips this
 * path entirely; it captures and publishes in one livekit-client call.
 */
export async function createCameraTrack(deviceId?: string): Promise<LocalTrack> {
  try {
    const lkTrack = await createLocalVideoTrack(deviceId ? { deviceId } : undefined);
    return new LocalTrack(lkTrack, 'camera');
  } catch (error) {
    throw toMediaError(error, 'camera');
  }
}
