import { createLocalScreenTracks } from 'livekit-client';
import { LocalTrack } from '../../track';
import { toMediaError } from './errors';

/**
 * Uses the browser's native getDisplayMedia() via livekit-client — no
 * custom capture logic. Screen-share audio, when the OS provides it,
 * comes back as a second track; we only surface video here, matching
 * room.enableScreenShare()'s single-track contract. Scope cut, not a bug.
 */
export async function createScreenShareTrack(): Promise<LocalTrack> {
  try {
    const lkTracks = await createLocalScreenTracks({ audio: false });
    const [videoTrack] = lkTracks;
    return new LocalTrack(videoTrack, 'screenShare');
  } catch (error) {
    throw toMediaError(error, 'screenShare');
  }
}
