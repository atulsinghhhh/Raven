import { audio } from '../src/audio';
import type { NativeAudioAdapter } from '../src/audio';
import { isRTCError } from '@corvidhq/rtc';
import { __calls, __resetCalls } from './mocks/react-native-incall-manager';
import { __setPlatform } from './mocks/react-native';

/**
 * Audio routing is the one part of the mobile SDK that could not simply
 * follow the web SDK off LiveKit: `AudioSession` had no upstream
 * equivalent. What replaced it is an adapter interface with a default
 * implementation over `react-native-incall-manager`, and two capabilities
 * that genuinely do not survive the move.
 *
 * These tests exist mostly to pin down that honesty — that the two
 * unsupported methods say so instead of silently doing nothing, which is
 * the failure mode that costs a developer an afternoon.
 */
describe('audio', () => {
  beforeEach(() => {
    __resetCalls();
    audio.__resetForTests();
    __setPlatform('android');
  });

  afterEach(() => {
    audio.__resetForTests();
  });

  describe('session lifecycle', () => {
    it('starts and stops the native session', async () => {
      await audio.start();
      expect(__calls.start).toBe(1);

      await audio.stop();
      expect(__calls.stop).toBe(1);
    });

    it('does not fail a call when no audio module is installed', async () => {
      // Video still works and routing falls back to whatever the OS
      // chose — degraded, not broken. Throwing here would stop a call
      // from connecting over a missing optional dependency.
      audio.setAdapter(undefined);

      await expect(audio.start()).resolves.toBeUndefined();
      await expect(audio.stop()).resolves.toBeUndefined();
    });
  });

  describe('setSpeakerphone', () => {
    it('forces the loudspeaker on', async () => {
      await audio.setSpeakerphone(true);
      expect(__calls.forceSpeakerphone).toEqual([true]);
    });

    it('hands the route back to the platform when turned off', async () => {
      // `null`, not `false`: on some platforms `false` means "force the
      // earpiece", which would override a connected headset — the exact
      // thing a speakerphone toggle must not do.
      await audio.setSpeakerphone(false);
      expect(__calls.forceSpeakerphone).toEqual([null]);
    });
  });

  describe('setOutput', () => {
    it('chooses a specific route on Android', async () => {
      await audio.setOutput('bluetooth');
      expect(__calls.chosenRoutes).toEqual(['BLUETOOTH']);
    });

    it('maps every Raven output onto an Android route', async () => {
      await audio.setOutput('speaker');
      await audio.setOutput('earpiece');
      await audio.setOutput('headset');
      await audio.setOutput('bluetooth');

      expect(__calls.chosenRoutes).toEqual([
        'SPEAKER_PHONE',
        'EARPIECE',
        'WIRED_HEADSET',
        'BLUETOOTH',
      ]);
    });

    it('falls back to the speaker toggle where route selection is unavailable', async () => {
      // iOS gives an app no way to force an arbitrary route, so the
      // default adapter advertises no selectOutput there.
      __setPlatform('ios');
      audio.__resetForTests();

      await audio.setOutput('speaker');
      expect(__calls.forceSpeakerphone).toEqual([true]);

      await audio.setOutput('earpiece');
      expect(__calls.forceSpeakerphone).toEqual([true, false]);
      expect(__calls.chosenRoutes).toEqual([]);
    });

    it('refuses a route it cannot honour rather than doing nothing', async () => {
      // Reporting success while leaving audio somewhere the user did not
      // ask for is worse than an error.
      __setPlatform('ios');
      audio.__resetForTests();

      await expect(audio.setOutput('bluetooth')).rejects.toMatchObject({
        code: 'NOT_SUPPORTED',
      });
      expect(__calls.forceSpeakerphone).toEqual([]);
    });
  });

  describe('capabilities the default adapter does not have', () => {
    it('reports getOutputs as unsupported instead of guessing a list', async () => {
      // A guessed list would put outputs in a picker that selecting does
      // nothing to.
      await expect(audio.getOutputs()).rejects.toMatchObject({ code: 'NOT_SUPPORTED' });
    });

    it('reports showRoutePicker as unsupported', async () => {
      await expect(audio.showRoutePicker()).rejects.toMatchObject({ code: 'NOT_SUPPORTED' });
    });

    it('names the fix in the error message', async () => {
      // "Not supported" on its own is not actionable; the message has to
      // say what to do about it.
      try {
        await audio.getOutputs();
        throw new Error('expected a rejection');
      } catch (error) {
        expect(isRTCError(error)).toBe(true);
        expect((error as Error).message).toContain('setAdapter');
      }
    });
  });

  describe('a custom adapter', () => {
    it('takes over every capability', async () => {
      const calls: string[] = [];
      const custom: NativeAudioAdapter = {
        startSession: async () => void calls.push('start'),
        stopSession: async () => void calls.push('stop'),
        setForceSpeakerphone: async (enabled) => void calls.push(`speaker:${enabled}`),
        selectOutput: async (output) => void calls.push(`output:${output}`),
        availableOutputs: async () => ['speaker', 'bluetooth'],
        showRoutePicker: async () => void calls.push('picker'),
      };

      audio.setAdapter(custom);

      await audio.start();
      await audio.setSpeakerphone(true);
      await audio.setOutput('bluetooth');
      await audio.showRoutePicker();
      await expect(audio.getOutputs()).resolves.toEqual(['speaker', 'bluetooth']);
      await audio.stop();

      expect(calls).toEqual([
        'start',
        'speaker:true',
        'output:bluetooth',
        'picker',
        'stop',
      ]);
      // The default adapter was never consulted.
      expect(__calls.start).toBe(0);
    });

    it('distinguishes "no module installed" from "platform cannot do this"', async () => {
      // Two problems with different fixes; one message for both is how a
      // developer spends an afternoon on the wrong one.
      audio.setAdapter(undefined);

      await expect(audio.setSpeakerphone(true)).rejects.toMatchObject({
        code: 'NOT_SUPPORTED',
      });
      try {
        await audio.setSpeakerphone(true);
      } catch (error) {
        expect((error as Error).message).toContain('react-native-incall-manager');
      }
    });
  });
});
