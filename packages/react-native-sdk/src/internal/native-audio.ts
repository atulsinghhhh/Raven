import { Platform } from 'react-native';
import type { RavenAudioOutput } from '../audio';

/**
 * The platform capabilities call-audio routing needs.
 *
 * # Why this is an interface rather than a direct dependency
 *
 * Raven previously got audio routing from `@livekit/react-native`'s
 * `AudioSession`, which bundled session management, output selection,
 * device enumeration and the iOS route picker into one native module.
 * There is no single upstream package that does all of that:
 * `react-native-incall-manager` covers session management and output
 * selection well, does device enumeration only on Android, and does not
 * implement the iOS route picker at all.
 *
 * Rather than pretend otherwise, the pieces the platform genuinely cannot
 * do are `undefined` here, `audio.ts` reports them as `NOT_SUPPORTED`,
 * and an app that needs full fidelity can supply its own adapter
 * (`audio.setAdapter`) wrapping whatever native module it already has —
 * an `AVRoutePickerView` bridge, say. That is a real limitation, stated
 * rather than hidden; see docs/sdk/react-native.md#audio-routing.
 */
export interface NativeAudioAdapter {
  /** Claims the audio session for a call. Sets the category/mode so the earpiece and speaker behave. */
  startSession(): Promise<void>;
  stopSession(): Promise<void>;

  /**
   * Forces the loudspeaker on or off.
   *
   * `null` means "return to the platform's own choice", which is what
   * respects a connected headset or Bluetooth device instead of
   * overriding the user's obviously-intended output.
   */
  setForceSpeakerphone(enabled: boolean | null): Promise<void>;

  /**
   * Selects a specific output. Optional: iOS gives an app no way to force
   * a route other than the speaker, so this is Android-only in the
   * default adapter.
   */
  selectOutput?(output: RavenAudioOutput): Promise<void>;

  /**
   * Currently available outputs. Optional for the same reason —
   * enumeration comes from an Android-only device-change event.
   */
  availableOutputs?(): Promise<RavenAudioOutput[]>;

  /** The system route picker. Optional; iOS-only, and no upstream module provides it. */
  showRoutePicker?(): Promise<void>;
}

/**
 * `react-native-incall-manager`'s surface, as much of it as is used here.
 *
 * Declared locally rather than imported so this package does not need the
 * module's types at build time — it is an optional peer, and a project
 * that only uses Raven Chat should not have to install a call-audio
 * native module to typecheck.
 */
interface InCallManagerModule {
  start(options?: { media?: 'audio' | 'video'; auto?: boolean; ringback?: string }): void;
  stop(options?: { busytone?: string }): void;
  setForceSpeakerphoneOn(enabled: boolean | null): void;
  chooseAudioRoute?(route: string): Promise<unknown>;
}

/** Android's route names, which differ from Raven's vocabulary. */
const ANDROID_ROUTES: Record<RavenAudioOutput, string> = {
  speaker: 'SPEAKER_PHONE',
  earpiece: 'EARPIECE',
  headset: 'WIRED_HEADSET',
  bluetooth: 'BLUETOOTH',
};

/**
 * Loads `react-native-incall-manager` if the app has it installed.
 *
 * `require` rather than a static import, and swallowed on failure,
 * because the module is an optional peer dependency: an app using Raven
 * for chat only, or one that supplies its own adapter, must not fail to
 * start because a call-audio native module is missing. `audio.ts` reports
 * a clear error if routing is then actually used.
 */
function loadInCallManager(): InCallManagerModule | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require('react-native-incall-manager') as
      | InCallManagerModule
      | { default: InCallManagerModule };
    return 'default' in loaded ? loaded.default : loaded;
  } catch {
    return undefined;
  }
}

/**
 * The default adapter, over `react-native-incall-manager`.
 *
 * Returns `undefined` when the module is not installed, so `audio.ts` can
 * tell "not configured" from "the platform cannot do this" — two problems
 * with different fixes.
 */
export function createDefaultAudioAdapter(): NativeAudioAdapter | undefined {
  const inCallManager = loadInCallManager();
  if (!inCallManager) {
    return undefined;
  }

  const adapter: NativeAudioAdapter = {
    async startSession() {
      // `media: 'video'` rather than `'audio'` even for a voice call: it
      // is what stops the proximity sensor blanking the screen, and a
      // voice call in a video app still has a UI the user is looking at.
      // `auto: true` lets the module follow headset and Bluetooth changes
      // on its own, which is the behaviour that is right by default.
      inCallManager.start({ media: 'video', auto: true });
    },

    async stopSession() {
      inCallManager.stop();
    },

    async setForceSpeakerphone(enabled: boolean | null) {
      inCallManager.setForceSpeakerphoneOn(enabled);
    },
  };

  // Only advertised where it actually works. On iOS `chooseAudioRoute` is
  // not implemented, and claiming support would leave audio somewhere the
  // user did not ask for while reporting success.
  if (Platform.OS === 'android' && typeof inCallManager.chooseAudioRoute === 'function') {
    adapter.selectOutput = async (output: RavenAudioOutput) => {
      await inCallManager.chooseAudioRoute!(ANDROID_ROUTES[output]);
    };
  }

  return adapter;
}
