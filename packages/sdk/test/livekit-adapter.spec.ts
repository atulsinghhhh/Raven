// Regression coverage for a real bug found during live browser testing:
// a participant who joined *before* you connect never fires
// RoomEvent.ParticipantConnected/TrackSubscribed for you, so without
// explicit bootstrap logic they'd never appear in your room at all.
import { TypedEventEmitter } from '../src/events';

const RoomEvent = {
  ConnectionStateChanged: 'connectionStateChanged',
  Disconnected: 'disconnected',
  ParticipantConnected: 'participantConnected',
  ParticipantDisconnected: 'participantDisconnected',
  TrackPublished: 'trackPublished',
  TrackUnpublished: 'trackUnpublished',
  TrackSubscribed: 'trackSubscribed',
  TrackUnsubscribed: 'trackUnsubscribed',
  LocalTrackPublished: 'localTrackPublished',
  LocalTrackUnpublished: 'localTrackUnpublished',
  DataReceived: 'dataReceived',
  MediaDevicesError: 'mediaDevicesError',
};

const ConnectionState = {
  Disconnected: 'disconnected',
  Connecting: 'connecting',
  Connected: 'connected',
  Reconnecting: 'reconnecting',
  SignalReconnecting: 'signalReconnecting',
};

const Track = {
  Source: {
    Camera: 'camera',
    Microphone: 'microphone',
    ScreenShare: 'screen_share',
    ScreenShareAudio: 'screen_share_audio',
    Unknown: 'unknown',
  },
};

class FakeLKRoom extends TypedEventEmitter<Record<string, (...args: never[]) => void>> {
  localParticipant: unknown;
  remoteParticipants: Map<string, unknown>;

  constructor(preExistingParticipants: Map<string, unknown> = new Map()) {
    super();
    this.localParticipant = { identity: '' };
    this.remoteParticipants = preExistingParticipants;
  }

  async connect(): Promise<void> {
    this.localParticipant = { identity: 'local-user' };
  }

  async disconnect(): Promise<void> {}

  static getLocalDevices = jest.fn().mockResolvedValue([]);

  switchActiveDevice = jest.fn();
}

let roomInstances: FakeLKRoom[] = [];
let nextPreExisting: Map<string, unknown> = new Map();

jest.mock('livekit-client', () => ({
  ConnectionError: class ConnectionError extends Error {},
  ConnectionErrorReason: { NotAllowed: 0, Timeout: 5, ServerUnreachable: 1, WebSocket: 6 },
  ConnectionState,
  Room: class {
    constructor() {
      const instance = new FakeLKRoom(nextPreExisting);
      roomInstances.push(instance);
      return instance;
    }
    static getLocalDevices = jest.fn().mockResolvedValue([]);
  },
  RoomEvent,
  Track,
}));

// Imported after the mock so LiveKitAdapter picks up the fake module.
import { LiveKitAdapter } from '../src/internal/sfu/livekit-adapter';
import { createLogger } from '../src/logger';

function fakeRemoteParticipant(identity: string, tracks: Array<{ source: string; track: unknown }>) {
  return {
    identity,
    metadata: undefined,
    trackPublications: new Map(tracks.map((t, i) => [String(i), { source: t.source, track: t.track }])),
  };
}

function fakeRemoteTrack() {
  return {
    mediaStreamTrack: {} as MediaStreamTrack,
    isMuted: false,
    attach: jest.fn(),
    detach: jest.fn(() => []),
  };
}

describe('LiveKitAdapter — bootstrapping participants already in the room', () => {
  beforeEach(() => {
    roomInstances = [];
    nextPreExisting = new Map();
  });

  it('reports a participant who joined before us, once connect() resolves', async () => {
    const bobTrack = fakeRemoteTrack();
    nextPreExisting = new Map([
      ['bob', fakeRemoteParticipant('bob', [{ source: 'camera', track: bobTrack }])],
    ]);

    const adapter = new LiveKitAdapter(createLogger('silent'), true);
    const joined = jest.fn();
    const subscribed = jest.fn();
    adapter.on('participantJoined', joined);
    adapter.on('trackSubscribed', subscribed);

    await adapter.connect('wss://rtc.example.com', 'token');

    expect(joined).toHaveBeenCalledTimes(1);
    expect(joined.mock.calls[0][0].identity).toBe('bob');
    expect(adapter.remoteParticipants.get('bob')?.identity).toBe('bob');

    expect(subscribed).toHaveBeenCalledTimes(1);
    const [track, participant] = subscribed.mock.calls[0];
    expect(track.kind).toBe('camera');
    expect(participant.identity).toBe('bob');
    expect(participant.tracks).toHaveLength(1);
  });

  it('does not emit a phantom participantJoined when no one was already in the room', async () => {
    const adapter = new LiveKitAdapter(createLogger('silent'), true);
    const joined = jest.fn();
    adapter.on('participantJoined', joined);

    await adapter.connect('wss://rtc.example.com', 'token');

    expect(joined).not.toHaveBeenCalled();
    expect(adapter.remoteParticipants.size).toBe(0);
  });

  it('bootstraps multiple pre-existing participants, each with their own tracks', async () => {
    nextPreExisting = new Map([
      ['bob', fakeRemoteParticipant('bob', [{ source: 'camera', track: fakeRemoteTrack() }])],
      [
        'carol',
        fakeRemoteParticipant('carol', [
          { source: 'camera', track: fakeRemoteTrack() },
          { source: 'microphone', track: fakeRemoteTrack() },
        ]),
      ],
    ]);

    const adapter = new LiveKitAdapter(createLogger('silent'), true);
    await adapter.connect('wss://rtc.example.com', 'token');

    expect(adapter.remoteParticipants.size).toBe(2);
    expect(adapter.remoteParticipants.get('carol')?.tracks.map((t) => t.kind).sort()).toEqual([
      'camera',
      'microphone',
    ]);
  });

  it('skips a publication that has not actually resolved to a track yet', async () => {
    nextPreExisting = new Map([['bob', fakeRemoteParticipant('bob', [{ source: 'camera', track: undefined }])]]);

    const adapter = new LiveKitAdapter(createLogger('silent'), true);
    const subscribed = jest.fn();
    adapter.on('trackSubscribed', subscribed);

    await adapter.connect('wss://rtc.example.com', 'token');

    expect(subscribed).not.toHaveBeenCalled();
    expect(adapter.remoteParticipants.get('bob')?.tracks).toHaveLength(0);
  });
});
