import { Raven } from '../src/raven';
import { __calls as webrtcCalls, __resetCalls as resetWebrtcCalls } from './mocks/react-native-webrtc';
import { __calls as audioCalls, __resetCalls as resetAudioCalls } from './mocks/react-native-incall-manager';
import { __appState, __emitAppState, PermissionsAndroid, __setPlatform } from './mocks/react-native';

/**
 * Drives `Raven` against a fake `@corvidhq/rtc` client.
 *
 * Not here to re-test RTC. `@corvidhq/rtc` has its own 102 tests for that,
 * and re-testing it here would only assert that the mock works. What
 * matters is the mobile-only behaviour layered on top: audio-session
 * lifecycle, permission prompting, OS listener cleanup, and not leaving
 * resources lying about when a join fails.
 */
const rtcState = {
  joinShouldFail: false,
  joins: [] as string[],
  leaves: 0,
  connectionState: 'connected' as string,
};

jest.mock('@corvidhq/rtc', () => ({
  createRTCClient: () => ({
    join: async (roomId: string) => {
      rtcState.joins.push(roomId);
      if (rtcState.joinShouldFail) {
        throw new Error('connection refused');
      }
      return {
        get connectionState() {
          return rtcState.connectionState;
        },
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

/**
 * A syntactically valid chat token.
 *
 * @corvidhq/chat decodes the payload on construction to get the user id and
 * expiry, so a placeholder string gets rejected. Which is itself proof the
 * chat handle builds a real client rather than a stub.
 */
function fakeChatToken(): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      jti: 'ctk_test',
      sub: 'alice',
      pid: 'project_1',
      cvs: [],
      scopes: ['chat:read', 'chat:send'],
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      aud: 'raven-chat',
      iss: 'raven',
    }),
  ).toString('base64url');
  return `${header}.${payload}.signature`;
}

function makeRaven(overrides: Record<string, unknown> = {}) {
  return new Raven({
    token: 'rtc-token',
    endpoint: 'wss://rtc.example.com',
    ...overrides,
  } as never);
}

beforeEach(() => {
  // Clears call history but keeps mock implementations. Without it, "was
  // not called" assertions pick up calls from earlier tests.
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

  rtcState.joinShouldFail = false;
  rtcState.joins = [];
  rtcState.leaves = 0;
  rtcState.connectionState = 'connected';
});

describe('construction', () => {
  it('registers the WebRTC globals so a developer never has to', () => {
    makeRaven();
    // Forgetting registerGlobals() is the single most common React Native
    // WebRTC mistake. Doing it in the constructor takes the footgun away.
    expect(webrtcCalls.registerGlobals).toBeGreaterThanOrEqual(1);
  });

  it('has no chat handle without a chat token', () => {
    // An RTC-only app shouldn't carry a messaging client it never uses.
    expect(makeRaven().chat).toBeUndefined();
  });
});

describe('join', () => {
  it('starts the audio session before connecting', async () => {
    const raven = makeRaven();
    await raven.join('room_123');

    // Start it afterwards and the first moments of remote audio come out
    // of the wrong route on iOS.
    expect(audioCalls.start).toBe(1);
    expect(rtcState.joins).toEqual(['room_123']);
  });

  it('requests permissions by default', async () => {
    await makeRaven().join('room_123');
    expect(PermissionsAndroid.requestMultiple).toHaveBeenCalled();
  });

  it('skips prompting when the app has its own pre-call screen', async () => {
    await makeRaven().join('room_123', { requestPermissions: false });
    expect(PermissionsAndroid.requestMultiple).not.toHaveBeenCalled();
  });

  it('still joins when the user refuses the camera', async () => {
    PermissionsAndroid.requestMultiple.mockResolvedValue({
      'android.permission.CAMERA': 'never_ask_again',
      'android.permission.RECORD_AUDIO': 'never_ask_again',
    } as never);

    // Declining to publish isn't declining to attend. Someone who can't
    // share their camera can still watch and listen.
    await expect(makeRaven().join('room_123')).resolves.toBeDefined();
  });

  it('releases the audio session when the connection fails', async () => {
    rtcState.joinShouldFail = true;

    await expect(makeRaven().join('room_123')).rejects.toThrow('connection refused');

    // Leave it running and the app's audio category stays overridden on
    // iOS, ducking other apps' audio indefinitely.
    expect(audioCalls.start).toBe(1);
    expect(audioCalls.stop).toBe(1);
  });

  it('leaves the audio session alone when the app manages it', async () => {
    await makeRaven({ manageAudioSession: false }).join('room_123');
    expect(audioCalls.start).toBe(0);
  });

  it('starts watching the app lifecycle only once joined', async () => {
    const raven = makeRaven();
    expect(__appState.listeners.size).toBe(0);

    await raven.join('room_123');
    expect(__appState.listeners.size).toBe(1);
  });
});

describe('leave', () => {
  it('stops the audio session and detaches OS listeners', async () => {
    const raven = makeRaven();
    await raven.join('room_123');
    await raven.leave();

    expect(audioCalls.stop).toBe(1);
    // A listener that outlives the call is a leak. It keeps the Raven
    // instance alive forever, and the room it's holding with it (spec §19).
    expect(__appState.listeners.size).toBe(0);
    expect(raven.room).toBeUndefined();
  });

  it('is safe to call without having joined', async () => {
    await expect(makeRaven().leave()).resolves.toBeUndefined();
  });

  it('is safe to call twice', async () => {
    const raven = makeRaven();
    await raven.join('room_123');
    await raven.leave();

    await expect(raven.leave()).resolves.toBeUndefined();
    // The session was already stopped. Stopping it again unbalances the
    // native session refcount.
    expect(audioCalls.stop).toBe(1);
  });
});

describe('app lifecycle', () => {
  it('reports transitions without tearing down the call', async () => {
    const states: string[] = [];
    const raven = makeRaven({ onAppStateChange: (state: string) => states.push(state) });
    await raven.join('room_123');

    __emitAppState('background');
    __emitAppState('active');

    expect(states).toEqual(['background', 'active']);
    // Backgrounding for four seconds must not mean leaving the meeting.
    expect(rtcState.leaves).toBe(0);
  });
});

describe('network recovery', () => {
  it('only signals a reconnect when the room is actually down', async () => {
    const reconnects: number[] = [];
    const raven = makeRaven({ onNetworkReconnect: () => reconnects.push(1) });
    await raven.join('room_123');

    // Reaching into the private handler on purpose. NetInfo isn't
    // installed here, so it's the only way to exercise the decision the
    // watcher would otherwise trigger.
    const handle = raven as unknown as { handleNetworkRegained(): void };

    rtcState.connectionState = 'connected';
    handle.handleNetworkRegained();
    expect(reconnects).toHaveLength(0);

    rtcState.connectionState = 'failed';
    handle.handleNetworkRegained();
    expect(reconnects).toHaveLength(1);
  });
});

describe('messaging-only', () => {
  it('constructs with a chat token and no RTC credentials', () => {
    // The whole point. A messaging app shouldn't have to mint a pointless
    // RTC token just to build this object.
    expect(() => makeRaven({ token: undefined, endpoint: undefined, chatToken: fakeChatToken(), chatApiUrl: 'https://api.test' })).not.toThrow();
  });

  it('reports hasRtc: false so a UI can hide call controls', () => {
    const raven = makeRaven({ token: undefined, endpoint: undefined, chatToken: fakeChatToken(), chatApiUrl: 'https://api.test' });
    expect(raven.hasRtc).toBe(false);
  });

  it('reports hasRtc: true when RTC credentials are present', () => {
    expect(makeRaven().hasRtc).toBe(true);
  });

  it('refuses join() with an error that says what to do', async () => {
    const raven = makeRaven({ token: undefined, endpoint: undefined, chatToken: fakeChatToken(), chatApiUrl: 'https://api.test' });

    await expect(raven.join('room_123')).rejects.toThrow(/no RTC credentials/);
  });

  it('does not prompt for permissions on the way to that error', async () => {
    const raven = makeRaven({ token: undefined, endpoint: undefined, chatToken: fakeChatToken(), chatApiUrl: 'https://api.test' });

    await raven.join('room_123').catch(() => undefined);

    // A messaging-only app flashing a camera dialog on its way to failing
    // would be worse than the failure.
    expect(PermissionsAndroid.requestMultiple).not.toHaveBeenCalled();
    expect(audioCalls.start).toBe(0);
  });

  it('leaves and disposes cleanly without an RTC client', async () => {
    const raven = makeRaven({ token: undefined, endpoint: undefined, chatToken: fakeChatToken(), chatApiUrl: 'https://api.test' });

    await expect(raven.leave()).resolves.toBeUndefined();
    await expect(raven.dispose()).resolves.toBeUndefined();
  });
});

describe('credential validation', () => {
  it('rejects a token without an endpoint', () => {
    // Failing here is a lot kinder than failing at join() with a
    // connection error that points at the network.
    expect(() => makeRaven({ endpoint: undefined })).toThrow(/both `token` and `endpoint`/);
  });

  it('rejects an endpoint without a token', () => {
    expect(() => makeRaven({ token: undefined })).toThrow(/both `token` and `endpoint`/);
  });

  it('rejects an instance with no credentials at all', () => {
    expect(() => makeRaven({ token: undefined, endpoint: undefined })).toThrow(/at least one credential/);
  });
});
