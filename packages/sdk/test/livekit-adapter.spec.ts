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
  TrackMuted: 'trackMuted',
  TrackUnmuted: 'trackUnmuted',
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

  /** Test-only: TypedEventEmitter.emit() is protected, so tests can't call
   * `roomInstances[0].emit(...)` directly — this thin public wrapper (same
   * class, so the protected call is legal) lets a test trigger a raw
   * RoomEvent as if livekit-client itself had fired it. */
  triggerEvent<A extends unknown[]>(event: string, ...args: A): void {
    this.emit(event, ...(args as never[]));
  }
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

describe('LiveKitAdapter — mute/unmute forwarding (Phase 11)', () => {
  beforeEach(() => {
    roomInstances = [];
    nextPreExisting = new Map([['bob', fakeRemoteParticipant('bob', [])]]);
  });

  it('forwards a remote TrackMuted as trackMuted, with the participant resolved', async () => {
    const adapter = new LiveKitAdapter(createLogger('silent'), true);
    const muted = jest.fn();
    adapter.on('trackMuted', muted);
    await adapter.connect('wss://rtc.example.com', 'token');

    roomInstances[0].triggerEvent(RoomEvent.TrackMuted, { source: 'camera' }, { identity: 'bob', isLocal: false });

    expect(muted).toHaveBeenCalledTimes(1);
    expect(muted.mock.calls[0][0]).toBe('camera');
    expect(muted.mock.calls[0][1].identity).toBe('bob');
  });

  it('forwards a remote TrackUnmuted as trackUnmuted', async () => {
    const adapter = new LiveKitAdapter(createLogger('silent'), true);
    const unmuted = jest.fn();
    adapter.on('trackUnmuted', unmuted);
    await adapter.connect('wss://rtc.example.com', 'token');

    roomInstances[0].triggerEvent(RoomEvent.TrackUnmuted, { source: 'microphone' }, { identity: 'bob', isLocal: false });

    expect(unmuted).toHaveBeenCalledTimes(1);
    expect(unmuted.mock.calls[0][0]).toBe('microphone');
  });

  it('ignores a local participant muting their own track — never surfaced as a remote event', async () => {
    const adapter = new LiveKitAdapter(createLogger('silent'), true);
    const muted = jest.fn();
    adapter.on('trackMuted', muted);
    await adapter.connect('wss://rtc.example.com', 'token');

    roomInstances[0].triggerEvent(RoomEvent.TrackMuted, { source: 'camera' }, { identity: 'local-user', isLocal: true });

    expect(muted).not.toHaveBeenCalled();
  });
});

describe('LiveKitAdapter — setDevice (Phase 11: widened to accept audiooutput)', () => {
  beforeEach(() => {
    roomInstances = [];
    nextPreExisting = new Map();
  });

  it('passes an audiooutput device switch straight through to switchActiveDevice', async () => {
    const adapter = new LiveKitAdapter(createLogger('silent'), true);
    await adapter.connect('wss://rtc.example.com', 'token');

    await adapter.setDevice('audiooutput', 'speaker-1');

    expect(roomInstances[0].switchActiveDevice).toHaveBeenCalledWith('audiooutput', 'speaker-1');
  });
});
