import { AudioSession } from '@livekit/react-native';

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
 */
export const audio = {
  /**
   * Routes call audio to the loudspeaker, or back to the default route
   * (earpiece, or whatever is plugged in).
   *
   * Prefer this over `setOutput()` for a speakerphone toggle: it respects
   * a connected headset or Bluetooth device instead of overriding the
   * user's obviously-intended output.
   */
  async setSpeakerphone(enabled: boolean): Promise<void> {
    if (enabled) {
      await AudioSession.selectAudioOutput('speaker');
      return;
    }
    await AudioSession.selectAudioOutput('earpiece');
  },

  /**
   * Picks a specific output. Throws if that output isn't currently
   * available — a device that isn't connected can't be selected, and
   * pretending otherwise would leave audio somewhere the user didn't ask
   * for.
   */
  async setOutput(output: RavenAudioOutput): Promise<void> {
    await AudioSession.selectAudioOutput(output);
  },

  /**
   * What's currently available to route to. The list changes as headsets
   * and Bluetooth devices come and go, so read it when you render the
   * picker rather than caching it.
   */
  async getOutputs(): Promise<string[]> {
    return AudioSession.getAudioOutputs();
  },

  /**
   * iOS only. Shows the system route picker (the AirPlay-style sheet).
   * Preferred over a custom list on iOS, because it's the control users
   * already recognise. A no-op on Android, which has no equivalent.
   */
  async showRoutePicker(): Promise<void> {
    await AudioSession.showAudioRoutePicker();
  },

  /**
   * @internal Called by `Raven` when a room is joined. Exposed for apps
   * that manage the session themselves — for example one already holding
   * an audio session for its own playback.
   */
  async start(): Promise<void> {
    await AudioSession.startAudioSession();
  },

  /** @internal Counterpart to `start()`, called when the room is left. */
  async stop(): Promise<void> {
    await AudioSession.stopAudioSession();
  },
};
