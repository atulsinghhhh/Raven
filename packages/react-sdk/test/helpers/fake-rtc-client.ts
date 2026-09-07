/**
 * A hand-rolled fake of @corvidhq/rtc's public surface — mirrors how
 * packages/sdk's own tests fake `RTCPeerConnection`, one layer up. Every
 * @corvidhq/react test mocks the whole `@corvidhq/rtc` module with this file
 * (`jest.mock('@corvidhq/rtc', () => require('./helpers/fake-rtc-client'))`)
 * so store/hook/component logic can be tested without any real
 * WebRTC stack at all.
 */

type Handler = (...args: unknown[]) => void;

export class FakeEmitter {
  private listeners = new Map<string, Set<Handler>>();

  on(event: string, handler: Handler): this {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler);
    return this;
  }

  off(event: string, handler: Handler): this {
    this.listeners.get(event)?.delete(handler);
    return this;
  }

  /** Test-only — real @corvidhq/rtc keeps emit() protected; this fake needs it public to drive scenarios. */
  emit(event: string, ...args: unknown[]): void {
    for (const handler of Array.from(this.listeners.get(event) ?? [])) handler(...args);
  }
}

export class FakeParticipant {
  tracks: unknown[] = [];
  constructor(public identity: string) {}
}

export class FakeRoom extends FakeEmitter {
  connectionState: string = 'connected';
  localParticipant = new FakeParticipant('local-user');
  remoteParticipants: FakeParticipant[] = [];

  enableCamera = jest.fn(async () => undefined);
  disableCamera = jest.fn(async () => undefined);
  enableMicrophone = jest.fn(async () => undefined);
  disableMicrophone = jest.fn(async () => undefined);
  leave = jest.fn(async () => undefined);

  constructor(public roomId: string) {
    super();
  }
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export class FakeClient {
  /**
   * `RavenRoom` calls `join()` synchronously inside its mount effect —
   * before a test gets a chance to configure a mock return value. So
   * `join()` always returns THIS specific, already-pending promise,
   * which a test resolves/rejects directly via `pendingJoin.resolve(...)`
   * whenever it's ready — no race with when the effect actually fires.
   */
  pendingJoin: Deferred<FakeRoom> = defer<FakeRoom>();
  joinMock = jest.fn((_roomId: string) => this.pendingJoin.promise);
  leaveMock = jest.fn(async () => undefined);

  constructor(public config: unknown) {
    instances.push(this);
  }

  join(roomId: string): Promise<FakeRoom> {
    return this.joinMock(roomId);
  }

  leave(): Promise<void> {
    return this.leaveMock();
  }
}

export const instances: FakeClient[] = [];

export function lastClient(): FakeClient {
  const client = instances[instances.length - 1];
  if (!client) throw new Error('No FakeClient was created yet — call createRTCClient() first');
  return client;
}

export function resetFakeRtc(): void {
  instances.length = 0;
}

export function createRTCClient(config: unknown): FakeClient {
  return new FakeClient(config);
}

export class RTCError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RTCError';
  }
}

export function isRTCError(value: unknown): value is RTCError {
  return value instanceof RTCError;
}
