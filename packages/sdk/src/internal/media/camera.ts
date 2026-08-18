import { createLocalVideoTrack } from 'livekit-client';
import { LocalTrack } from '../../track';
import { toMediaError } from './errors';

/**
 * Captures a camera track without publishing it — the `client.createCameraTrack()`
 * + `room.publish(track)` pattern from Phase 6 spec §9, for callers who want
 * a preview before publishing. `room.enableCamera()` does not use this path;
 * it captures and publishes in one livekit-client call.
 */
export async function createCameraTrack(deviceId?: string): Promise<LocalTrack> {
  try {
    const lkTrack = await createLocalVideoTrack(deviceId ? { deviceId } : undefined);
    return new LocalTrack(lkTrack, 'camera');
  } catch (error) {
    throw toMediaError(error, 'camera');
  }
}
