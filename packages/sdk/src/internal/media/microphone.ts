import { createLocalAudioTrack } from 'livekit-client';
import { LocalTrack } from '../../track';
import { toMediaError } from './errors';

export async function createMicrophoneTrack(deviceId?: string): Promise<LocalTrack> {
  try {
    const lkTrack = await createLocalAudioTrack(deviceId ? { deviceId } : undefined);
    return new LocalTrack(lkTrack, 'microphone');
  } catch (error) {
    throw toMediaError(error, 'microphone');
  }
}
