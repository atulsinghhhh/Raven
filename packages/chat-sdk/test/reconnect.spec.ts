import { ChatClient } from '../src/client';
import { validateConfig } from '../src/config';
import { backoffDelayMs } from '../src/internal/backoff';
import { FakeSocket } from './helpers/fake-socket';
import { fakeToken } from './helpers/token';

function makeClient(overrides: Record<string, unknown> = {}): ChatClient {
  const config = validateConfig({
    token: fakeToken(),
    chatUrl: 'wss://api.test/v1/chat/ws',
    apiUrl: 'https://api.test',
    initialReconnectDelayMs: 100,
    maxReconnectDelayMs: 1000,
    maxReconnectAttempts: 3,
    ...overrides,
  });
  return new ChatClient(config, (url) => new FakeSocket(url));
}

async function connected(client: ChatClient, room = 'room_123'): Promise<FakeSocket> {
  const promise = client.connect({ room });
  const socket = FakeSocket.latest;
  socket.open();
  socket.hello();
  await Promise.resolve();
  socket.ackLast({ room });
  await promise;
  return socket;
}

beforeEach(() => {
  FakeSocket.reset();
});

describe('backoffDelayMs', () => {
  it('grows exponentially', () => {
    const noJitter = () => 1;
    expect(backoffDelayMs(1, 100, 10_000, noJitter)).toBe(100);
    expect(backoffDelayMs(2, 100, 10_000, noJitter)).toBe(200);
    expect(backoffDelayMs(3, 100, 10_000, noJitter)).toBe(400);
    expect(backoffDelayMs(4, 100, 10_000, noJitter)).toBe(800);
  });

  it('never exceeds the cap, however many attempts have failed', () => {
    for (let attempt = 1; attempt <= 50; attempt++) {
      expect(backoffDelayMs(attempt, 100, 5_000)).toBeLessThanOrEqual(5_000);
    }
  });

  it('jitters within a bounded window so a fleet does not retry in lockstep', () => {
    const low = backoffDelayMs(5, 100, 10_000, () => 0);
    const high = backoffDelayMs(5, 100, 10_000, () => 1);
    expect(low).toBeLessThan(high);
    // Floored at a quarter of the target, so a jittered delay can't
    // collapse to zero and burn an attempt instantly.
    expect(low).toBeGreaterThan(0);
  });
});

describe('reconnection', () => {
  it('reconnects after an unexpected drop', async () => {
    jest.useFakeTimers();
    try {
      const client = makeClient();
      const socket = await connected(client);
      const states: string[] = [];
      client.on('connectionStateChanged', (state) => states.push(state));

      socket.serverClose(1006, 'abnormal');
      expect(states).toContain('reconnecting');

      jest.advanceTimersByTime(5_000);
      expect(FakeSocket.instances.length).toBe(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('re-joins its rooms on the new socket; the server knows nothing about the old one', async () => {
    jest.useFakeTimers();
    try {
      const client = makeClient();
      const socket = await connected(client, 'support');

      socket.serverClose(1006, 'abnormal');
      jest.advanceTimersByTime(5_000);

      const next = FakeSocket.latest;
      next.open();
      next.hello();
      await Promise.resolve();
      await Promise.resolve();

      expect(next.lastFrameOfType('room.join')).toMatchObject({ room: 'support' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('gives up after maxReconnectAttempts instead of looping forever', async () => {
    jest.useFakeTimers();
    try {
      const client = makeClient({ maxReconnectAttempts: 2 });
      const errors: unknown[] = [];
      client.on('error', (error) => errors.push(error));

      const socket = await connected(client);
      socket.serverClose(1006, 'abnormal');

      // Fail every retry.
      for (let i = 0; i < 5; i++) {
        jest.advanceTimersByTime(30_000);
        FakeSocket.latest.serverClose(1006, 'abnormal');
      }

      // One original plus at most two retries. Never an unbounded ladder.
      expect(FakeSocket.instances.length).toBeLessThanOrEqual(3);
      expect(errors.some((e) => (e as { code: string }).code === 'CONNECTION_FAILED')).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not retry an auth rejection; retrying a revoked token is pointless', async () => {
    jest.useFakeTimers();
    try {
      const client = makeClient();
      const errors: Array<{ code: string }> = [];
      client.on('error', (error) => errors.push(error as unknown as { code: string }));

      const socket = await connected(client);
      socket.serverClose(4401, 'TOKEN_REVOKED');

      jest.advanceTimersByTime(60_000);

      expect(FakeSocket.instances.length).toBe(1);
      expect(client.connectionState).toBe('failed');
      expect(errors[0].code).toBe('TOKEN_REVOKED');
    } finally {
      jest.useRealTimers();
    }
  });

  it('rejects in-flight requests when the socket drops, rather than hanging until timeout', async () => {
    jest.useFakeTimers();
    try {
      const client = makeClient();
      const socket = await connected(client);

      const promise = client.sendMessage({ text: 'Hello' });
      socket.serverClose(1006, 'abnormal');

      await expect(promise).rejects.toMatchObject({ code: 'CONNECTION_CLOSED' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('emits reconnected (not connected) the second time around', async () => {
    jest.useFakeTimers();
    try {
      const client = makeClient();
      const socket = await connected(client);

      const events: string[] = [];
      client.on('connected', () => events.push('connected'));
      client.on('reconnected', () => events.push('reconnected'));

      socket.serverClose(1006, 'abnormal');
      jest.advanceTimersByTime(5_000);

      const next = FakeSocket.latest;
      next.open();
      next.hello();
      await Promise.resolve();
      next.ackLast({ room: 'room_123' });
      await Promise.resolve();
      await Promise.resolve();

      expect(events).toContain('reconnected');
      expect(events).not.toContain('connected');
    } finally {
      jest.useRealTimers();
    }
  });
});
