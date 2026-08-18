import { createLocalScreenTracks } from 'livekit-client';
import { LocalTrack } from '../../track';
import { toMediaError } from './errors';

/**
 * Uses the browser's native getDisplayMedia() (via livekit-client) — no
 * custom capture logic (Phase 6 spec §19). Screen-share audio, when the
 * browser/OS provides it, is a second track; MVP surfaces only the video
 * track, matching room.enableScreenShare()'s single-track contract. This
 * is a documented scope cut, not a bug — see docs/sdk.md#screen-sharing.
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
