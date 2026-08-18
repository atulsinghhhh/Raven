import { createLogger } from '../src/logger';
import { RemoteTrack } from '../src/track';
import { Room } from '../src/room';
import { FakeAdapter } from './helpers/fake-adapter';

const logger = createLogger('silent');

describe('Room — connection state events', () => {
  it('emits "connected" the first time the adapter reports connected', () => {
    const adapter = new FakeAdapter();
    const room = new Room(adapter, 'room-1', logger);
    const connected = jest.fn();
    room.on('connected', connected);

    adapter.setState('connected');

    expect(connected).toHaveBeenCalledTimes(1);
  });

  it('emits "reconnecting" then "reconnected" (not a second "connected") when recovering from a drop', () => {
    const adapter = new FakeAdapter();
    adapter.setState('connected');
    const room = new Room(adapter, 'room-1', logger);
    const connected = jest.fn();
    const reconnecting = jest.fn();
    const reconnected = jest.fn();
    room.on('connected', connected);
    room.on('reconnecting', reconnecting);
    room.on('reconnected', reconnected);

    adapter.setState('reconnecting');
    adapter.setState('connected');

    expect(reconnecting).toHaveBeenCalledTimes(1);
    expect(reconnected).toHaveBeenCalledTimes(1);
    expect(connected).not.toHaveBeenCalled();
  });

  it('emits "disconnected" on a clean disconnect, without an error event', () => {
    const adapter = new FakeAdapter();
    const room = new Room(adapter, 'room-1', logger);
    const disconnected = jest.fn();
    const error = jest.fn();
    room.on('disconnected', disconnected);
    room.on('error', error);

    adapter.setState('disconnected');

    expect(disconnected).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });

  it('emits both "disconnected" and a CONNECTION_FAILED error when reconnection is exhausted', () => {
    const adapter = new FakeAdapter();
    adapter.setState('connected');
    const room = new Room(adapter, 'room-1', logger);
    const disconnected = jest.fn();
    const error = jest.fn();
    room.on('disconnected', disconnected);
    room.on('error', error);

    adapter.setState('reconnecting');
    adapter.setState('failed');

    expect(disconnected).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0].code).toBe('CONNECTION_FAILED');
  });

  it('always forwards the raw state via connectionStateChanged', () => {
    const adapter = new FakeAdapter();
    const room = new Room(adapter, 'room-1', logger);
    const states: string[] = [];
    room.on('connectionStateChanged', (s) => states.push(s));

    adapter.setState('connecting');
    adapter.setState('connected');

    expect(states).toEqual(['connecting', 'connected']);
  });
});

describe('Room — participants and tracks', () => {
  it('forwards participantJoined/participantLeft from the adapter', () => {
    const adapter = new FakeAdapter();
    const room = new Room(adapter, 'room-1', logger);
    const joined = jest.fn();
    const left = jest.fn();
    room.on('participantJoined', joined);
    room.on('participantLeft', left);

    const participant = adapter.addRemoteParticipant('bob');
    adapter.removeRemoteParticipant(participant);

    expect(joined).toHaveBeenCalledWith(participant);
    expect(left).toHaveBeenCalledWith(participant);
    expect(room.remoteParticipants).toEqual([]);
  });

  it('remoteParticipants reflects the adapter map live', () => {
    const adapter = new FakeAdapter();
    const room = new Room(adapter, 'room-1', logger);

    adapter.addRemoteParticipant('bob');
    adapter.addRemoteParticipant('carol');

    expect(room.remoteParticipants.map((p) => p.identity).sort()).toEqual(['bob', 'carol']);
  });

  it('forwards trackSubscribed/trackUnsubscribed', () => {
    const adapter = new FakeAdapter();
    const room = new Room(adapter, 'room-1', logger);
    const subscribed = jest.fn();
    room.on('trackSubscribed', subscribed);

    const participant = adapter.addRemoteParticipant('bob');
    const track = new RemoteTrack(
      {
        mediaStreamTrack: {} as MediaStreamTrack,
        isMuted: false,
        attach: jest.fn(),
        detach: jest.fn(() => []),
      },
      'camera',
    );
    adapter.emitTrackSubscribed(track, participant);

    expect(subscribed).toHaveBeenCalledWith(track, participant);
  });
});

describe('Room — actions delegate to the adapter', () => {
  it('enableCamera()/disableCamera() call adapter.enableCamera(true/false)', async () => {
    const adapter = new FakeAdapter();
    const room = new Room(adapter, 'room-1', logger);

    await room.enableCamera();
    await room.disableCamera();

    expect(adapter.enableCameraCalls).toEqual([true, false]);
  });

  it('enableMicrophone()/disableMicrophone() call adapter.enableMicrophone(true/false)', async () => {
    const adapter = new FakeAdapter();
    const room = new Room(adapter, 'room-1', logger);

    await room.enableMicrophone();
    await room.disableMicrophone();

    expect(adapter.enableMicrophoneCalls).toEqual([true, false]);
  });

  it('setCameraDevice()/setMicrophoneDevice() delegate with the right device kind', async () => {
    const adapter = new FakeAdapter();
    const room = new Room(adapter, 'room-1', logger);

    await room.setCameraDevice('camera-42');
    await room.setMicrophoneDevice('mic-7');

    expect(adapter.setDeviceCalls).toEqual([
      { kind: 'videoinput', deviceId: 'camera-42' },
      { kind: 'audioinput', deviceId: 'mic-7' },
    ]);
  });

  it('sendData() encodes a string payload to bytes before handing it to the adapter', async () => {
    const adapter = new FakeAdapter();
    const room = new Room(adapter, 'room-1', logger);

    await room.sendData('hello');

    expect(adapter.sendDataCalls).toHaveLength(1);
    expect(new TextDecoder().decode(adapter.sendDataCalls[0])).toBe('hello');
  });

  it('leave() calls adapter.disconnect()', async () => {
    const adapter = new FakeAdapter();
    const room = new Room(adapter, 'room-1', logger);

    await room.leave();

    expect(adapter.disconnectCalls).toBe(1);
  });
});

describe('Room — telemetry (best-effort, Phase 9)', () => {
  function fakeTelemetry() {
    return { connectionId: 'conn_test123', send: jest.fn() };
  }

  it('exposes the telemetry client\'s connectionId as its own public connectionId', () => {
    const adapter = new FakeAdapter();
    const telemetry = fakeTelemetry();
    const room = new Room(adapter, 'room-1', logger, telemetry);

    expect(room.connectionId).toBe('conn_test123');
  });

  it('sends "connected" (not "reconnected") on the first successful connection', () => {
    const adapter = new FakeAdapter();
    const telemetry = fakeTelemetry();
    const room = new Room(adapter, 'room-1', logger, telemetry);

    adapter.setState('connected');

    expect(telemetry.send).toHaveBeenCalledWith('connected');
    expect(telemetry.send).not.toHaveBeenCalledWith('reconnected');
    void room;
  });

  it('sends "reconnecting" then "reconnected" (not a second "connected") when recovering', () => {
    const adapter = new FakeAdapter();
    adapter.setState('connected');
    const telemetry = fakeTelemetry();
    new Room(adapter, 'room-1', logger, telemetry);
    telemetry.send.mockClear();

    adapter.setState('reconnecting');
    adapter.setState('connected');

    expect(telemetry.send).toHaveBeenCalledWith('reconnecting');
    expect(telemetry.send).toHaveBeenCalledWith('reconnected');
    expect(telemetry.send).not.toHaveBeenCalledWith('connected');
  });

  it('increments reconnectCount (visible via getDiagnostics) only on an actual reconnect', () => {
    const adapter = new FakeAdapter();
    adapter.setState('connected');
    const room = new Room(adapter, 'room-1', logger, fakeTelemetry());

    adapter.setState('reconnecting');
    adapter.setState('connected');
    adapter.setState('reconnecting');
    adapter.setState('connected');

    expect(room.getDiagnostics().reconnectCount).toBe(2);
  });

  it('sends "connection_failed" and an "error" event when the adapter reports failed', () => {
    const adapter = new FakeAdapter();
    adapter.setState('connected');
    const telemetry = fakeTelemetry();
    new Room(adapter, 'room-1', logger, telemetry);
    telemetry.send.mockClear();

    adapter.setState('failed');

    expect(telemetry.send).toHaveBeenCalledWith('connection_failed');
    expect(telemetry.send).toHaveBeenCalledWith('error', expect.objectContaining({ code: 'CONNECTION_FAILED' }));
  });

  it('sends "disconnected" (not "connection_failed") on a clean disconnect', () => {
    const adapter = new FakeAdapter();
    adapter.setState('connected');
    const telemetry = fakeTelemetry();
    new Room(adapter, 'room-1', logger, telemetry);
    telemetry.send.mockClear();

    adapter.setState('disconnected');

    expect(telemetry.send).toHaveBeenCalledWith('disconnected');
    expect(telemetry.send).not.toHaveBeenCalledWith('connection_failed');
  });

  it('sends participant_joined/participant_left with the participant identity', () => {
    const adapter = new FakeAdapter();
    const telemetry = fakeTelemetry();
    new Room(adapter, 'room-1', logger, telemetry);

    const participant = adapter.addRemoteParticipant('bob');
    adapter.removeRemoteParticipant(participant);

    expect(telemetry.send).toHaveBeenCalledWith('participant_joined', { participantIdentity: 'bob' });
    expect(telemetry.send).toHaveBeenCalledWith('participant_left', { participantIdentity: 'bob' });
  });

  it('getDiagnostics() never includes a token or any secret-shaped field', () => {
    const adapter = new FakeAdapter();
    adapter.setState('connected');
    const room = new Room(adapter, 'room-1', logger, fakeTelemetry());

    const diagnostics = room.getDiagnostics();

    expect(diagnostics).toEqual({
      connectionState: 'connected',
      iceConnectionState: undefined,
      signalingState: undefined,
      reconnectCount: 0,
      sdkVersion: expect.any(String),
      platform: expect.any(String),
      browser: expect.any(String),
    });
    expect(JSON.stringify(diagnostics)).not.toMatch(/token|secret|credential/i);
  });

  it('defaults to a working no-op telemetry client when none is provided, without throwing', () => {
    const adapter = new FakeAdapter();
    const room = new Room(adapter, 'room-1', logger);

    expect(() => adapter.setState('connected')).not.toThrow();
    expect(room.connectionId).toMatch(/^conn_/);
  });
});
