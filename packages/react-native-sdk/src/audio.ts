import { RTCError } from '@corvidhq/rtc';
import { createDefaultAudioAdapter, type NativeAudioAdapter } from './internal/native-audio';

/** Where call audio is playing. */
export type RavenAudioOutput = 'speaker' | 'earpiece' | 'headset' | 'bluetooth';

/**
 * Call audio routing — the mobile-only concern the web SDK has no
 * equivalent for.
 *
 * On a phone, "which speaker is this coming out of" is a real question
 * with a wrong answer: a video call that plays through the earpiece at
 * arm's length sounds broken, and one that plays through the loudspeaker
 * when the user has AirPods in is worse. The OS also reroutes underneath
 * you when a headset is plugged in, a call comes through, or Bluetooth
 * connects.
 *
 * `Raven` starts and stops the audio session around a room automatically,
 * so the default behaviour is correct without any of this being called.
 * This module is for the cases where the app wants to override it — a
 * speakerphone button being the obvious one.
 *
 * # What backs this
 *
 * Raven no longer bundles an audio-session implementation. The default
 * adapter uses `react-native-incall-manager`, an optional peer
 * dependency; `setAdapter()` replaces it. Two methods —
 * `getOutputs()` and `showRoutePicker()` — have no upstream
 * implementation and report `NOT_SUPPORTED` unless an adapter provides
 * them. See docs/sdk/react-native.md#audio-routing for why, and for what
 * to do if you need them.
 */

let adapter: NativeAudioAdapter | undefined;
let adapterResolved = false;

function resolveAdapter(): NativeAudioAdapter | undefined {
  if (!adapterResolved) {
    adapterResolved = true;
    adapter = createDefaultAudioAdapter();
  }
  return adapter;
}

/**
 * Requires an adapter, with an error that says which of the two problems
 * this is.
 *
 * "You have not installed the native module" and "this platform cannot do
 * that" need different fixes, and collapsing them into one message is how
 * a developer spends an afternoon on the wrong one.
 */
function requireAdapter(): NativeAudioAdapter {
  const resolved = resolveAdapter();
  if (!resolved) {
    throw new RTCError(
      'NOT_SUPPORTED',
      'Call audio routing needs a native module. Install react-native-incall-manager, ' +
        'or supply your own with audio.setAdapter(). See docs/sdk/react-native.md#audio-routing.',
    );
  }
  return resolved;
}

export const audio = {
  /**
   * Replaces the audio-routing implementation.
   *
   * For apps that already hold an audio session, or that need the two
   * capabilities the default adapter lacks. Call it before joining a
   * room.
   */
  setAdapter(custom: NativeAudioAdapter | undefined): void {
    adapter = custom;
    adapterResolved = true;
  },

  /**
   * Routes call audio to the loudspeaker, or back to the default route
   * (earpiece, or whatever is plugged in).
   *
   * Prefer this over `setOutput()` for a speakerphone toggle: passing
   * `false` returns control to the platform, which respects a connected
   * headset or Bluetooth device instead of overriding the user's
   * obviously-intended output.
   */
  async setSpeakerphone(enabled: boolean): Promise<void> {
    // `null`, not `false`, when turning it off — `false` on some
    // platforms means "force the earpiece", which would override a
    // connected headset. `null` hands the decision back.
    await requireAdapter().setForceSpeakerphone(enabled ? true : null);
  },

  /**
   * Picks a specific output.
   *
   * Android only in the default adapter. iOS gives an app no way to force
   * a route other than the speaker — the OS owns that decision — so
   * anything but `'speaker'` reports `NOT_SUPPORTED` there rather than
   * silently doing nothing. Use `setSpeakerphone()` on iOS, or
   * `showRoutePicker()` with an adapter that implements it.
   */
  async setOutput(output: RavenAudioOutput): Promise<void> {
    const resolved = requireAdapter();

    if (resolved.selectOutput) {
      await resolved.selectOutput(output);
      return;
    }

    // Falling back to the speaker toggle covers the two cases that can be
    // expressed everywhere, and refuses the rest instead of pretending.
    if (output === 'speaker') {
      await resolved.setForceSpeakerphone(true);
      return;
    }
    if (output === 'earpiece') {
      await resolved.setForceSpeakerphone(false);
      return;
    }

    throw new RTCError(
      'NOT_SUPPORTED',
      `Selecting the "${output}" output is not supported on this platform. ` +
        'Use audio.setSpeakerphone(), or supply an adapter with audio.setAdapter().',
    );
  },

  /**
   * What's currently available to route to. The list changes as headsets
   * and Bluetooth devices come and go, so read it when you render the
   * picker rather than caching it.
   *
   * Reports `NOT_SUPPORTED` unless the adapter can enumerate — the
   * default one cannot. Returning a guessed list would put outputs in a
   * picker that selecting does nothing to.
   */
  async getOutputs(): Promise<RavenAudioOutput[]> {
    const resolved = requireAdapter();
    if (!resolved.availableOutputs) {
      throw new RTCError(
        'NOT_SUPPORTED',
        'Enumerating audio outputs is not supported by the current audio adapter. ' +
          'Supply one that implements availableOutputs() with audio.setAdapter().',
      );
    }
    return resolved.availableOutputs();
  },

  /**
   * Shows the system route picker (iOS's AirPlay-style sheet).
   *
   * Reports `NOT_SUPPORTED` unless the adapter implements it; no upstream
   * React Native module does. It is preferable to a custom list on iOS
   * when available, because it is the control users already recognise.
   */
  async showRoutePicker(): Promise<void> {
    const resolved = requireAdapter();
    if (!resolved.showRoutePicker) {
      throw new RTCError(
        'NOT_SUPPORTED',
        'The system audio route picker is not supported by the current audio adapter. ' +
          'Supply one that bridges AVRoutePickerView with audio.setAdapter().',
      );
    }
    await resolved.showRoutePicker();
  },

  /**
   * @internal Called by `Raven` when a room is joined. Exposed for apps
   * that manage the session themselves — for example one already holding
   * an audio session for its own playback.
   *
   * Best-effort: a missing audio module must not stop a call from
   * connecting. Video still works, and audio routing falls back to
   * whatever the OS chose — degraded, not broken.
   */
  async start(): Promise<void> {
    await resolveAdapter()?.startSession();
  },

  /** @internal Counterpart to `start()`, called when the room is left. */
  async stop(): Promise<void> {
    await resolveAdapter()?.stopSession();
  },

  /** @internal test-only — forces the default adapter to be looked up again. */
  __resetForTests(): void {
    adapter = undefined;
    adapterResolved = false;
  },
};

export type { NativeAudioAdapter } from './internal/native-audio';
