import { RTCClient, createRTCClient } from '../src/client';
import { RTCError } from '../src/errors';
import { FakeAdapter } from './helpers/fake-adapter';
import { makeToken } from './helpers/token';

describe('createRTCClient', () => {
  it('returns an RTCClient for a valid config', () => {
    const token = makeToken({ video: { room: 'room-1' } });
    const client = createRTCClient({ token, endpoint: 'wss://rtc.example.com' });
    expect(client).toBeInstanceOf(RTCClient);
  });

  it('throws INVALID_TOKEN synchronously for a missing token — never reaches the network', () => {
    expect(() => createRTCClient({ token: '', endpoint: 'wss://rtc.example.com' })).toThrow(RTCError);
  });
});

describe('RTCClient.join', () => {
  it('connects the adapter with the configured endpoint/token/iceServers and returns a Room for that roomId', async () => {
    const token = makeToken({ video: { room: 'room-1' } });
    const iceServers = [{ urls: 'stun:example.com:3478' }];
    let capturedAdapter: FakeAdapter | undefined;

    const client = new RTCClient(
      { token, endpoint: 'wss://rtc.example.com', iceServers, logLevel: 'silent', autoReconnect: true },
      () => {
        capturedAdapter = new FakeAdapter();
        return capturedAdapter;
      },
    );

    const room = await client.join('room-1');

    expect(room.roomId).toBe('room-1');
    expect(capturedAdapter?.connectCalls).toEqual([{ endpoint: 'wss://rtc.example.com', token, iceServers }]);
  });

  it('throws ROOM_NOT_FOUND before ever calling adapter.connect() when roomId does not match the token', async () => {
    const token = makeToken({ video: { room: 'room-1' } });
    let capturedAdapter: FakeAdapter | undefined;

    const client = new RTCClient({ token, endpoint: 'wss://rtc.example.com', logLevel: 'silent', autoReconnect: true }, () => {
      capturedAdapter = new FakeAdapter();
      return capturedAdapter;
    });

    await expect(client.join('a-different-room')).rejects.toMatchObject({ code: 'ROOM_NOT_FOUND' });
    expect(capturedAdapter).toBeUndefined();
  });

  it('propagates a connection failure from the adapter as a rejected promise', async () => {
    const token = makeToken({ video: { room: 'room-1' } });
    const client = new RTCClient({ token, endpoint: 'wss://rtc.example.com', logLevel: 'silent', autoReconnect: true }, () => {
      const adapter = new FakeAdapter();
      adapter.connect = jest.fn().mockRejectedValue(new RTCError('NETWORK_ERROR', 'unreachable'));
      return adapter;
    });

    await expect(client.join('room-1')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
});

describe('RTCClient.leave', () => {
  it('leaves the most recently joined room', async () => {
    const token = makeToken({ video: { room: 'room-1' } });
    let capturedAdapter: FakeAdapter | undefined;
    const client = new RTCClient({ token, endpoint: 'wss://rtc.example.com', logLevel: 'silent', autoReconnect: true }, () => {
      capturedAdapter = new FakeAdapter();
      return capturedAdapter;
    });

    await client.join('room-1');
    await client.leave();

    expect(capturedAdapter?.disconnectCalls).toBe(1);
  });

  it('is a no-op when no room has been joined', async () => {
    const token = makeToken({ video: { room: 'room-1' } });
    const client = createRTCClient({ token, endpoint: 'wss://rtc.example.com' });
    await expect(client.leave()).resolves.toBeUndefined();
  });
});

describe('RTCClient.setCamera / setMicrophone', () => {
  it('throws when called before joining a room', async () => {
    const token = makeToken({ video: { room: 'room-1' } });
    const client = createRTCClient({ token, endpoint: 'wss://rtc.example.com' });

    await expect(client.setCamera('device-1')).rejects.toBeInstanceOf(RTCError);
    await expect(client.setMicrophone('device-2')).rejects.toBeInstanceOf(RTCError);
  });

  it('delegates to the joined room once one exists', async () => {
    const token = makeToken({ video: { room: 'room-1' } });
    let capturedAdapter: FakeAdapter | undefined;
    const client = new RTCClient({ token, endpoint: 'wss://rtc.example.com', logLevel: 'silent', autoReconnect: true }, () => {
      capturedAdapter = new FakeAdapter();
      return capturedAdapter;
    });

    await client.join('room-1');
    await client.setCamera('device-1');
    await client.setMicrophone('device-2');

    expect(capturedAdapter?.setDeviceCalls).toEqual([
      { kind: 'videoinput', deviceId: 'device-1' },
      { kind: 'audioinput', deviceId: 'device-2' },
    ]);
  });
});
