import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';
import { ProjectOriginService } from './project-origin.service';

/**
 * A minimal in-process stand-in for Redis pub/sub, shared by several
 * `ProjectOriginService` instances so they genuinely talk to each other.
 *
 * The point of these tests is the multi-instance behaviour, and mocking
 * each instance's Redis separately would assert only that `publish` was
 * called — never that the *other* instance acted on it, which is the part
 * that was actually broken.
 */
class FakeRedisBus {
  private readonly subscribers = new Map<string, Set<(channel: string, msg: string) => void>>();
  publishFailure?: Error;
  /** Set to make SUBSCRIBE throw, modelling a slow or partitioned Redis at boot. */
  subscribeFailure?: Error;
  subscribeCalls = 0;
  /** The connections handed out, so a test can fire their `ready` event. */
  connections: Record<string, unknown>[] = [];
  publishes: { channel: string; message: string }[] = [];

  /**
   * One "connection". `duplicate()` hands back another view of the same
   * bus, which is what lets a subscriber and a publisher on the same
   * instance talk to each other exactly as ioredis does.
   */
  client = (): Record<string, unknown> => {
    const handlers: ((channel: string, msg: string) => void)[] = [];
    const readyHandlers: (() => void)[] = [];

    const conn: Record<string, unknown> = {
      duplicate: () => this.client(),
      on: (event: string, handler: (channel: string, msg: string) => void) => {
        if (event === 'message') handlers.push(handler);
        // ioredis emits `ready` on connect and on every reconnect; the
        // service re-subscribes on it, so the fake has to offer it.
        if (event === 'ready') readyHandlers.push(handler as unknown as () => void);
        return conn;
      },
      emitReady: () => readyHandlers.forEach((h) => h()),
      subscribe: async (channel: string) => {
        if (this.subscribeFailure) throw this.subscribeFailure;
        this.subscribeCalls += 1;
        const set = this.subscribers.get(channel) ?? new Set();
        for (const handler of handlers) set.add(handler);
        this.subscribers.set(channel, set);
      },
      publish: async (channel: string, message: string) => {
        if (this.publishFailure) throw this.publishFailure;
        this.publishes.push({ channel, message });
        for (const handler of this.subscribers.get(channel) ?? []) handler(channel, message);
        return 1;
      },
      quit: async () => undefined,
    };
    this.connections.push(conn);
    return conn;
  };

  asRedisService(): RedisService {
    return { client: this.client() } as unknown as RedisService;
  }
}

/**
 * One API instance: its own service and its own `findUnique` spy, so
 * "did this instance re-read the database?" is answerable per instance.
 */
async function makeInstance(
  bus: FakeRedisBus,
  policy: () => { allowedOrigins: string[]; allowLocalhostOrigins: boolean },
): Promise<{ service: ProjectOriginService; findUnique: jest.Mock }> {
  const findUnique = jest.fn(async () => policy());
  const prisma = { project: { findUnique } } as unknown as PrismaService;
  const service = new ProjectOriginService(prisma, bus.asRedisService());
  await service.onModuleInit();
  return { service, findUnique };
}

describe('origin cache invalidation across API instances', () => {
  it('an added origin reaches an instance that never served the edit', async () => {
    // Instance B has the project cached from before the change. Without a
    // broadcast it would keep refusing the new origin until its TTL lapsed.
    const bus = new FakeRedisBus();
    let stored = { allowedOrigins: ['https://old.example.com'], allowLocalhostOrigins: false };

    const a = await makeInstance(bus, () => stored);
    const b = await makeInstance(bus, () => stored);

    await expect(b.service.isAllowed('p1', 'https://new.example.com')).resolves.toBe(false);

    // The edit lands on instance A only.
    stored = {
      allowedOrigins: ['https://old.example.com', 'https://new.example.com'],
      allowLocalhostOrigins: false,
    };
    await a.service.invalidate('p1');

    await expect(b.service.isAllowed('p1', 'https://new.example.com')).resolves.toBe(true);
  });

  it('a removed origin stops being accepted on every instance, not just the one that served the edit', async () => {
    // The security-relevant direction: a stale cache here means an origin
    // the developer just revoked is still being let in elsewhere.
    const bus = new FakeRedisBus();
    let stored = {
      allowedOrigins: ['https://keep.example.com', 'https://revoked.example.com'],
      allowLocalhostOrigins: false,
    };

    const a = await makeInstance(bus, () => stored);
    const b = await makeInstance(bus, () => stored);

    await expect(b.service.isAllowed('p1', 'https://revoked.example.com')).resolves.toBe(true);

    stored = { allowedOrigins: ['https://keep.example.com'], allowLocalhostOrigins: false };
    await a.service.invalidate('p1');

    await expect(b.service.isAllowed('p1', 'https://revoked.example.com')).resolves.toBe(false);
    await expect(b.service.isAllowed('p1', 'https://keep.example.com')).resolves.toBe(true);
  });

  it('invalidates the edited project only, leaving other projects cached', async () => {
    // A broadcast that cleared everything would turn one dashboard save
    // into a fleet-wide cache stampede on the hot path.
    const bus = new FakeRedisBus();
    const policy = { allowedOrigins: ['https://a.example.com'], allowLocalhostOrigins: false };
    const a = await makeInstance(bus, () => policy);
    const b = await makeInstance(bus, () => policy);

    await b.service.isAllowed('p1', 'https://a.example.com');
    await b.service.isAllowed('p2', 'https://a.example.com');
    const readsBefore = b.findUnique.mock.calls.length;

    await a.service.invalidate('p1');

    await b.service.isAllowed('p2', 'https://a.example.com');
    // p2 was untouched, so still served from cache: no new read.
    expect(b.findUnique.mock.calls.length).toBe(readsBefore);

    await b.service.isAllowed('p1', 'https://a.example.com');
    // p1 was dropped, so this one did re-read.
    expect(b.findUnique.mock.calls.length).toBe(readsBefore + 1);
  });

  it('publishes the project id on the shared channel', async () => {
    const bus = new FakeRedisBus();
    const a = await makeInstance(bus, () => ({
      allowedOrigins: [],
      allowLocalhostOrigins: true,
    }));

    await a.service.invalidate('project-42');

    expect(bus.publishes).toEqual([{ channel: 'raven:origins:invalidate', message: 'project-42' }]);
  });

  it('still clears the local cache when the broadcast fails', async () => {
    // The instance that served the edit must be correct even with Redis
    // down; the others fall back to the TTL.
    const bus = new FakeRedisBus();
    let stored = {
      allowedOrigins: ['https://a.example.com', 'https://gone.example.com'],
      allowLocalhostOrigins: false,
    };
    const a = await makeInstance(bus, () => stored);

    await expect(a.service.isAllowed('p1', 'https://gone.example.com')).resolves.toBe(true);

    bus.publishFailure = new Error('redis down');
    stored = { allowedOrigins: ['https://a.example.com'], allowLocalhostOrigins: false };

    // Does not throw: the database write already committed.
    await expect(a.service.invalidate('p1')).resolves.toBeUndefined();
    await expect(a.service.isAllowed('p1', 'https://gone.example.com')).resolves.toBe(false);
  });

  it('recovers from a SUBSCRIBE that failed at boot, on the next ready', async () => {
    // This is the regression the e2e run exposed: ioredis inherits a short
    // commandTimeout, SUBSCRIBE timed out once during startup, and the
    // instance then served stale origin policy for its whole lifetime
    // while every test still passed. A reconnect has to bring it back.
    const bus = new FakeRedisBus();
    bus.subscribeFailure = new Error('Command timed out');

    let stored = {
      allowedOrigins: ['https://a.example.com', 'https://gone.example.com'],
      allowLocalhostOrigins: false,
    };
    const findUnique = jest.fn(async () => stored);
    const b = new ProjectOriginService({ project: { findUnique } } as unknown as PrismaService, bus.asRedisService());
    await b.onModuleInit();

    // Cache it, then change the policy on another instance.
    await expect(b.isAllowed('p1', 'https://gone.example.com')).resolves.toBe(true);
    const a = await makeInstance(bus, () => stored);
    stored = { allowedOrigins: ['https://a.example.com'], allowLocalhostOrigins: false };
    await a.service.invalidate('p1');

    // Still stale: this instance never managed to subscribe.
    await expect(b.isAllowed('p1', 'https://gone.example.com')).resolves.toBe(true);

    // Redis comes back and the connection re-readies.
    bus.subscribeFailure = undefined;
    for (const conn of bus.connections) {
      (conn.emitReady as (() => void) | undefined)?.();
    }
    await new Promise((r) => setTimeout(r, 0));

    // Now a fresh invalidation reaches it.
    await a.service.invalidate('p1');
    await expect(b.isAllowed('p1', 'https://gone.example.com')).resolves.toBe(false);
  });

  it('works with no Redis at all, falling back to TTL-only invalidation', async () => {
    const findUnique = jest.fn(async () => ({
      allowedOrigins: ['https://a.example.com'],
      allowLocalhostOrigins: false,
    }));
    const service = new ProjectOriginService({
      project: { findUnique },
    } as unknown as PrismaService);

    await service.onModuleInit();

    await expect(service.isAllowed('p1', 'https://a.example.com')).resolves.toBe(true);
    await expect(service.invalidate('p1')).resolves.toBeUndefined();
    await service.onModuleDestroy();
  });
});
