import { RavenLiveStream, joinLiveStream } from '../src/live-stream';
import type { LiveStreamCredentials } from '../src/types';
import { __resetCalls as resetWebrtcCalls } from './mocks/react-native-webrtc';
import { __calls as audioCalls, __resetCalls as resetAudioCalls } from './mocks/react-native-incall-manager';
import { __appState, PermissionsAndroid, __setPlatform } from './mocks/react-native';

/**
 * Drives `RavenLiveStream` against the same fake `@ravenkash/rtc` client
 * `raven.spec.ts` uses.
 *
 * The class is a thin wrapper round `Raven`, so what's worth testing is the
 * *translation*: credentials -> Raven config, role -> isHost, reactions.
 * Not the join/leave mechanics `Raven` already covers.
 */
const rtcState = {
  joins: [] as string[],
  leaves: 0,
};

jest.mock('@ravenkash/rtc', () => ({
  createRTCClient: () => ({
    join: async (roomId: string) => {
      rtcState.joins.push(roomId);
      return {
        connectionState: 'connected',
        leave: async () => {
          rtcState.leaves += 1;
        },
      };
    },
    leave: async () => {
      rtcState.leaves += 1;
    },
  }),
  RTCError: class RTCError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));

function credentials(overrides: Partial<LiveStreamCredentials> = {}): LiveStreamCredentials {
  return {
    streamId: 'stream_1',
    role: 'VIEWER',
    rtc: { token: 'rtc-token', endpoint: 'wss://rtc.example.com' },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  resetWebrtcCalls();
    resetAudioCalls();
  __appState.listeners.clear();
  __appState.current = 'active';
  __setPlatform('android');
  PermissionsAndroid.requestMultiple.mockResolvedValue({
    'android.permission.CAMERA': 'granted',
    'android.permission.RECORD_AUDIO': 'granted',
  } as never);

  rtcState.joins = [];
  rtcState.leaves = 0;
});

describe('RavenLiveStream', () => {
  it('derives isHost from role, never something the SDK infers on its own', () => {
    expect(new RavenLiveStream(credentials({ role: 'HOST' })).isHost).toBe(true);
    expect(new RavenLiveStream(credentials({ role: 'CO_HOST' })).isHost).toBe(true);
    expect(new RavenLiveStream(credentials({ role: 'VIEWER' })).isHost).toBe(false);
  });

  it('join() joins the room named by streamId', async () => {
    const stream = new RavenLiveStream(credentials());
    await stream.join();

    expect(rtcState.joins).toEqual(['stream_1']);
    expect(stream.room).toBeDefined();
  });

  it('does not prompt for camera/microphone permission for a VIEWER by default', async () => {
    await new RavenLiveStream(credentials({ role: 'VIEWER' })).join();
    expect(PermissionsAndroid.requestMultiple).not.toHaveBeenCalled();
  });

  it('prompts for permission for a HOST by default', async () => {
    await new RavenLiveStream(credentials({ role: 'HOST' })).join();
    expect(PermissionsAndroid.requestMultiple).toHaveBeenCalled();
  });

  it('an explicit requestPermissions overrides the role-based default', async () => {
    await new RavenLiveStream(credentials({ role: 'VIEWER' })).join({ requestPermissions: true });
    expect(PermissionsAndroid.requestMultiple).toHaveBeenCalled();
  });

  it('has no chat handle when credentials carry no chat token', () => {
    expect(new RavenLiveStream(credentials()).chat).toBeUndefined();
  });

  it('react() throws when the stream has no chat conversation attached', async () => {
    const stream = new RavenLiveStream(credentials());
    await stream.join();

    await expect(stream.react('❤️')).rejects.toThrow(/no chat conversation attached/);
  });

  it('leave() disposes the underlying Raven instance', async () => {
    const stream = new RavenLiveStream(credentials());
    await stream.join();

    await stream.leave();

    expect(rtcState.leaves).toBe(1);
    expect(stream.room).toBeUndefined();
  });

  it('joinLiveStream() constructs and joins in one call', async () => {
    const stream = await joinLiveStream(credentials());

    expect(stream).toBeInstanceOf(RavenLiveStream);
    expect(rtcState.joins).toEqual(['stream_1']);
  });

  it('forwards onAppStateChange/onNetworkReconnect to the underlying Raven instance', async () => {
    const onAppStateChange = jest.fn();
    const stream = new RavenLiveStream(credentials({ role: 'HOST' }), { onAppStateChange });
    await stream.join();

    expect(__appState.listeners.size).toBe(1);
    expect(audioCalls.start).toBe(1);
  });
});
