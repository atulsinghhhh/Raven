import { RTCError } from '../../errors';
import type { DeviceInfo, DeviceKind } from '../sfu/types';

/**
 * Lists available media devices.
 *
 * Labels are empty until permission has been granted at least once — a
 * privacy measure in every browser, not something the SDK can work
 * around. A device with no label still has a usable `deviceId`, so a
 * caller can select it; there is just nothing meaningful to show a user
 * until they have allowed access once.
 */
export async function listDevices(kind?: DeviceKind): Promise<DeviceInfo[]> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
    throw new RTCError(
      'NOT_SUPPORTED',
      'Device enumeration is not available in this environment (no navigator.mediaDevices)',
    );
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((device) => !kind || device.kind === kind)
    .map((device) => ({
      deviceId: device.deviceId,
      label: device.label,
      kind: device.kind as DeviceKind,
    }));
}
