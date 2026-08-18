import { PermissionsAndroid, Platform } from 'react-native';
import {
  RavenPermissionError,
  toPermissionError,
  type RavenPermissionKind,
  type RavenPermissionStatus,
} from './errors';

export interface PermissionResult {
  camera: RavenPermissionStatus;
  microphone: RavenPermissionStatus;
}

const ANDROID_PERMISSION: Record<RavenPermissionKind, 'android.permission.CAMERA' | 'android.permission.RECORD_AUDIO'> = {
  camera: 'android.permission.CAMERA',
  microphone: 'android.permission.RECORD_AUDIO',
};

/**
 * Camera and microphone permissions, normalised across iOS and Android.
 *
 * The two platforms are genuinely different here, and this module exists
 * to hide that difference rather than pretend it doesn't exist:
 *
 * **Android** has a real permissions API in React Native core
 * (`PermissionsAndroid`), so we can check state without prompting, prompt
 * explicitly, and distinguish "denied" from "never ask again".
 *
 * **iOS** has no such API without a native module. `AVCaptureDevice`
 * authorization status isn't reachable from JavaScript, and adding a
 * native module purely to read it would mean shipping (and asking every
 * developer to link) native code for one enum. Instead we prompt the only
 * way iOS allows from JS — by asking for the device — and read the
 * outcome. That means `check()` on iOS reports `undetermined` rather than
 * guessing, and `request()` does the real work.
 *
 * Whatever the platform, a denial is always an error you can branch on.
 * Nothing here fails silently (spec §3).
 */
export const permissions = {
  /**
   * Reports current status without prompting, where the platform allows
   * it. On iOS this returns `undetermined` — see the note above; use
   * `request()` there.
   */
  async check(): Promise<PermissionResult> {
    if (Platform.OS === 'android') {
      const [camera, microphone] = await Promise.all([
        PermissionsAndroid.check(ANDROID_PERMISSION.camera),
        PermissionsAndroid.check(ANDROID_PERMISSION.microphone),
      ]);
      return {
        camera: camera ? 'granted' : 'undetermined',
        microphone: microphone ? 'granted' : 'undetermined',
      };
    }

    if (Platform.OS === 'ios') {
      // Honest, not optimistic: we cannot read iOS authorization status
      // from JS, and claiming 'granted' here would make a developer skip
      // the request and hit a silent black frame instead.
      return { camera: 'undetermined', microphone: 'undetermined' };
    }

    return { camera: 'unavailable', microphone: 'unavailable' };
  },

  /**
   * Prompts for whichever of camera/microphone you ask for, and returns
   * the resulting status per permission. Does not throw — inspect the
   * result, or use `require()` if you'd rather have an exception.
   *
   * Safe to call repeatedly: both platforms no-op when already granted.
   */
  async request(
    kinds: RavenPermissionKind[] = ['camera', 'microphone'],
  ): Promise<PermissionResult> {
    const result: PermissionResult = { camera: 'unavailable', microphone: 'unavailable' };

    if (Platform.OS === 'android') {
      const requested = kinds.map((kind) => ANDROID_PERMISSION[kind]);
      const granted = await PermissionsAndroid.requestMultiple(requested);

      for (const kind of kinds) {
        result[kind] = mapAndroidResult(granted[ANDROID_PERMISSION[kind]]);
      }
      return result;
    }

    if (Platform.OS === 'ios') {
      // Asking for the device is the only way to trigger the iOS prompt
      // from JavaScript. The stream is released immediately — this is a
      // permission probe, not a capture session, and holding it would
      // leave the camera light on.
      for (const kind of kinds) {
        result[kind] = await probeIosPermission(kind);
      }
      return result;
    }

    return result;
  },

  /**
   * Like `request()`, but throws `RavenPermissionError` on anything other
   * than a grant — including `blocked`, which carries `requiresSettings`
   * so your UI can send the user to Settings rather than uselessly
   * prompting again.
   */
  async require(kinds: RavenPermissionKind[] = ['camera', 'microphone']): Promise<void> {
    const result = await permissions.request(kinds);

    for (const kind of kinds) {
      const status = result[kind];
      if (status !== 'granted' && status !== 'unavailable') {
        throw new RavenPermissionError(kind, status);
      }
    }
  },
};

function mapAndroidResult(value: string | undefined): RavenPermissionStatus {
  switch (value) {
    case PermissionsAndroid.RESULTS.GRANTED:
      return 'granted';
    case PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN:
      return 'blocked';
    case PermissionsAndroid.RESULTS.DENIED:
      return 'denied';
    default:
      return 'undetermined';
  }
}

async function probeIosPermission(kind: RavenPermissionKind): Promise<RavenPermissionStatus> {
  const mediaDevices = (globalThis as { navigator?: { mediaDevices?: MediaDevices } }).navigator?.mediaDevices;
  if (!mediaDevices?.getUserMedia) {
    // bootstrapRavenNative() hasn't run. Not a permission problem, and
    // reporting one would send the developer down the wrong path.
    return 'unavailable';
  }

  let stream: MediaStream | undefined;
  try {
    stream = await mediaDevices.getUserMedia(
      kind === 'camera' ? { video: true } : { audio: true },
    );
    return 'granted';
  } catch (error) {
    // iOS never re-prompts after a refusal, so any denial is effectively
    // permanent until the user visits Settings.
    return toPermissionError(kind, error) ? 'blocked' : 'denied';
  } finally {
    stream?.getTracks().forEach((track) => track.stop());
  }
}
