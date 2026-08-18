import { Room } from 'livekit-client';
import type { DeviceInfo, DeviceKind } from '../sfu/types';

/**
 * Uses livekit-client's Room.getLocalDevices(), which itself wraps
 * navigator.mediaDevices.enumerateDevices() — no custom device-capture code.
 */
export async function listDevices(kind?: DeviceKind): Promise<DeviceInfo[]> {
  const infos = await Room.getLocalDevices(kind, true);
  return infos.map((info) => ({
    deviceId: info.deviceId,
    label: info.label,
    kind: info.kind as DeviceKind,
  }));
}
