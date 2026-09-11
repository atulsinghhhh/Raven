import { ConfigService } from '@nestjs/config';
import { UsageKind, UsageProduct } from '../../generated/prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { Environment } from '../../shared/environment/environment.constants';
import { FakeUsageStore } from './testing/fake-usage-store';
import { UsageAllowanceService } from './usage-allowance.service';
import { UsageMeterService } from './usage-meter.service';
import { minutesToSeconds, UsageCloseReason } from './usage.constants';

const START = new Date('2026-06-01T10:00:00.000Z');

/** `n` seconds after the session start. */
function at(seconds: number): Date {
  return new Date(START.getTime() + seconds * 1000);
}

describe('UsageMeterService', () => {
  let store: FakeUsageStore;
  let meter: UsageMeterService;
  let config: Record<string, unknown>;

  beforeEach(() => {
    store = new FakeUsageStore();
    store.seedAllowance();
    config = {
      'usage.freeTierRtcMinutes': 20_000,
      'usage.enforceLimit': true,
      'usage.meterIntervalMs': 30_000,
      'usage.reaperIntervalMs': 60_000,
      'usage.abandonedAfterMs': 180_000,
    };
    const configService = { get: jest.fn((key: string) => config[key]) } as unknown as ConfigService;
    const prisma = store.asPrisma() as unknown as PrismaService;
    meter = new UsageMeterService(prisma, configService, new UsageAllowanceService(prisma, configService));
  });

  describe('opening a meter', () => {
    it('records a session from server-side state only', async () => {
      const session = await meter.startSession({
        sessionKey: 'conn_abc',
        projectId: 'p_1',
        environment: Environment.PRODUCTION,
        roomId: 'r_1',
        roomName: 'lobby',
        participantIdentity: 'alice',
      });

      expect(session).toMatchObject({
        sessionKey: 'conn_abc',
        allowanceId: 'ua_1',
        userId: 'u_1',
        projectId: 'p_1',
        meteredSeconds: 0,
        endedAt: null,
      });
    });

    it('is idempotent on the session key, and does not restart the clock', async () => {
      const input = {
        sessionKey: 'conn_abc',
        projectId: 'p_1',
        environment: Environment.DEVELOPMENT,
        roomId: 'r_1',
        roomName: 'lobby',
        participantIdentity: 'alice',
      };

      const first = await meter.startSession(input);
      const second = await meter.startSession(input);

      expect(second.id).toBe(first.id);
      expect(second.startedAt).toEqual(first.startedAt);
      expect(store.sessions.size).toBe(1);
    });
  });

  describe('consumption', () => {
    it('credits the elapsed seconds to the allowance', async () => {
      const session = store.seedSession({ startedAt: START });

      const result = await meter.settle(session.sessionKey, { at: at(600) });

      expect(result).toMatchObject({ addedSeconds: 600, consumedSeconds: 600 });
      expect(store.allowance().consumedSeconds).toBe(600);
      expect(store.session(session.id).meteredSeconds).toBe(600);
    });

    it('credits only the difference on each subsequent settlement', async () => {
      const session = store.seedSession({ startedAt: START });

      await meter.settle(session.sessionKey, { at: at(30) });
      await meter.settle(session.sessionKey, { at: at(60) });
      const third = await meter.settle(session.sessionKey, { at: at(90) });

      // Three settlements, 90 seconds total — not 30 + 60 + 90.
      expect(third).toMatchObject({ addedSeconds: 30 });
      expect(store.allowance().consumedSeconds).toBe(90);
    });

    it('floors a partial second rather than crediting it', async () => {
      const session = store.seedSession({ startedAt: START });

      await meter.settle(session.sessionKey, { at: new Date(START.getTime() + 1_999) });

      expect(store.allowance().consumedSeconds).toBe(1);
    });

    it('credits nothing for a settlement instant before the session started', async () => {
      // A clock stepping backwards must read as "nothing yet", never as a
      // negative credit that hands minutes back.
      const session = store.seedSession({ startedAt: START });

      await meter.settle(session.sessionKey, { at: new Date(START.getTime() - 60_000) });

      expect(store.allowance().consumedSeconds).toBe(0);
    });

    it('credits inside a transaction, so the session and the allowance cannot diverge', async () => {
      const session = store.seedSession({ startedAt: START });

      await meter.settle(session.sessionKey, { at: at(60) });

      expect(store.transactions).toBe(1);
    });

    it('returns null for a session that was never opened', async () => {
      expect(await meter.settle('conn_unknown', { at: at(60) })).toBeNull();
    });
  });

  describe('idempotency', () => {
    it('counts the same settlement instant once, however many times it is replayed', async () => {
      const session = store.seedSession({ startedAt: START });

      await meter.settle(session.sessionKey, { at: at(300) });
      await meter.settle(session.sessionKey, { at: at(300) });
      await meter.settle(session.sessionKey, { at: at(300) });

      expect(store.allowance().consumedSeconds).toBe(300);
    });

    it('counts a duplicated leave once, and credits nothing after the close', async () => {
      // SignalingGateway.handleDisconnect routes ROOM_LEAVE, so an
      // explicit room.leave followed by the socket closing settles the
      // same session twice on the real path.
      const session = store.seedSession({ startedAt: START });

      await meter.settle(session.sessionKey, { at: at(120), close: UsageCloseReason.LEFT });
      await meter.settle(session.sessionKey, { at: at(180), close: UsageCloseReason.LEFT });

      // The second close is a no-op: the first one already ended it, and
      // `endedAt` records when — not when the duplicate arrived.
      const closed = store.session(session.id);
      expect(closed.endedAt).toEqual(at(120));
      expect(closed.closeReason).toBe(UsageCloseReason.LEFT);
      // 120, not 180. A closed session is final, so the minute between the
      // two calls is not credited — the participant was already gone.
      expect(store.allowance().consumedSeconds).toBe(120);
    });

    it('credits nothing for a settlement that arrives after the session closed', async () => {
      const session = store.seedSession({ startedAt: START, meteredSeconds: 60, endedAt: at(60) });

      expect(await meter.settle(session.sessionKey, { at: at(600) })).toBeNull();
      expect(store.session(session.id).meteredSeconds).toBe(60);
      expect(store.allowance().consumedSeconds).toBe(0);
    });

    it('never moves metered seconds backwards', async () => {
      const session = store.seedSession({ startedAt: START });

      await meter.settle(session.sessionKey, { at: at(600) });
      const late = await meter.settle(session.sessionKey, { at: at(60) });

      expect(late).toBeNull();
      expect(store.session(session.id).meteredSeconds).toBe(600);
      expect(store.allowance().consumedSeconds).toBe(600);
    });
  });

  describe('concurrency', () => {
    it('credits once when two settlements of the same session interleave', async () => {
      // Both read `meteredSeconds = 0`, then both try to write. Only the
      // compare-and-swap winner credits; the loser must add nothing.
      const session = store.seedSession({ startedAt: START });

      const [first, second] = await Promise.all([
        meter.settle(session.sessionKey, { at: at(120) }),
        meter.settle(session.sessionKey, { at: at(120) }),
      ]);

      const credited = [first, second].filter((result) => result !== null);
      expect(credited).toHaveLength(1);
      expect(store.allowance().consumedSeconds).toBe(120);
    });

    it('sums concurrent sessions sharing one allowance', async () => {
      // Three participants in a call are three sessions against one
      // developer's minutes. Ten minutes of a three-way call is thirty
      // participant-minutes.
      const sessions = [
        store.seedSession({ startedAt: START }),
        store.seedSession({ startedAt: START }),
        store.seedSession({ startedAt: START }),
      ];

      await Promise.all(sessions.map((session) => meter.settle(session.sessionKey, { at: at(600) })));

      expect(store.allowance().consumedSeconds).toBe(1_800);
    });

    it('a sweep and a leave racing on one session still credit it once', async () => {
      // `sweep` reads the wall clock, so this one session has to be
      // anchored to it rather than to START.
      const startedAt = new Date(Date.now() - 45_000);
      const session = store.seedSession({ startedAt });

      await Promise.all([
        meter.sweep([session.sessionKey]),
        meter.settle(session.sessionKey, { at: new Date(startedAt.getTime() + 45_000), close: UsageCloseReason.LEFT }),
      ]);

      // Whichever won, the total is that winner's elapsed reading, never
      // the sum of both.
      const consumed = store.allowance().consumedSeconds;
      expect(consumed).toBeGreaterThan(0);
      expect(consumed).toBeLessThanOrEqual(46);
      expect(store.session(session.id).meteredSeconds).toBe(consumed);
    });
  });

  describe('sweeping live sessions', () => {
    it('settles only the sessions it is handed', async () => {
      // An instance may only meter sockets it holds. Metering every live
      // row instead would keep charging for a crashed instance's sessions.
      const mine = store.seedSession({ startedAt: START });
      const someoneElses = store.seedSession({ startedAt: START });

      await meter.sweep([mine.sessionKey]);

      expect(store.session(mine.id).meteredSeconds).toBeGreaterThan(0);
      expect(store.session(someoneElses.id).meteredSeconds).toBe(0);
    });

    it('skips sessions that have already ended', async () => {
      const ended = store.seedSession({ startedAt: START, endedAt: at(60), meteredSeconds: 60 });

      await meter.sweep([ended.sessionKey]);

      expect(store.session(ended.id).meteredSeconds).toBe(60);
    });

    it('does nothing at all when the instance holds no sessions', async () => {
      expect(await meter.sweep([])).toBe(0);
      expect(store.transactions).toBe(0);
    });

    it('refreshes lastMeteredAt even when there is nothing new to credit', async () => {
      // Otherwise a session swept twice inside the same second looks stale
      // to the reaper and gets closed while it is very much alive.
      const startedAt = new Date();
      const staleReading = new Date(startedAt.getTime() - 60_000);
      const session = store.seedSession({ startedAt, meteredSeconds: 0, lastMeteredAt: staleReading });

      await meter.sweep([session.sessionKey]);

      const swept = store.session(session.id);
      expect(swept.meteredSeconds).toBe(0);
      expect(swept.lastMeteredAt.getTime()).toBeGreaterThan(staleReading.getTime());
    });
  });

  describe('reaping abandoned sessions', () => {
    it('closes a session whose gateway stopped settling it', async () => {
      const session = store.seedSession({
        startedAt: START,
        meteredSeconds: 60,
        lastMeteredAt: new Date(Date.now() - 10 * 60 * 1000),
      });

      const result = await meter.reap();

      expect(result.closed).toBe(1);
      expect(store.session(session.id).closeReason).toBe(UsageCloseReason.ABANDONED);
      expect(store.session(session.id).endedAt).toEqual(session.lastMeteredAt);
    });

    it('credits an abandoned session only up to its last confirmed-alive instant', async () => {
      // The participant stopped when the gateway died. Crediting to now
      // would bill a developer for Livqeno's outage.
      const lastAlive = new Date(START.getTime() + 120_000);
      const session = store.seedSession({ startedAt: START, meteredSeconds: 60, lastMeteredAt: lastAlive });

      await meter.reap();

      expect(store.session(session.id).meteredSeconds).toBe(120);
      expect(store.allowance().consumedSeconds).toBe(60);
    });

    it('leaves a recently settled session alone', async () => {
      const session = store.seedSession({ startedAt: START, lastMeteredAt: new Date() });

      expect(await meter.reap()).toMatchObject({ closed: 0 });
      expect(store.session(session.id).endedAt).toBeNull();
    });

    it('is safe to run twice — a second pass finds nothing to close', async () => {
      store.seedSession({
        startedAt: START,
        meteredSeconds: 0,
        lastMeteredAt: new Date(Date.now() - 10 * 60 * 1000),
      });

      const first = await meter.reap();
      const second = await meter.reap();

      expect(first.closed).toBe(1);
      expect(second.closed).toBe(0);
      expect(second.addedSeconds).toBe(0);
    });
  });

  describe('exhaustion', () => {
    it('stamps exhaustedAt on the settlement that spends the allowance', async () => {
      const oneMinuteLeft = minutesToSeconds(20_000) - 60;
      store.seedAllowance({ consumedSeconds: oneMinuteLeft });
      const session = store.seedSession({ startedAt: START });

      const result = await meter.settle(session.sessionKey, { at: at(120), close: UsageCloseReason.LEFT });

      expect(result?.justExhausted).toBe(true);
      expect(store.allowance().exhaustedAt).toEqual(at(120));
    });

    it('reports justExhausted only once, on the crossing', async () => {
      store.seedAllowance({ consumedSeconds: minutesToSeconds(20_000) - 60 });
      const first = store.seedSession({ startedAt: START });
      const second = store.seedSession({ startedAt: START });

      const crossing = await meter.settle(first.sessionKey, { at: at(120) });
      const after = await meter.settle(second.sessionKey, { at: at(120) });

      expect(crossing?.justExhausted).toBe(true);
      expect(after?.justExhausted).toBe(false);
    });

    it('never rewrites exhaustedAt, so the allowance cannot silently reset', async () => {
      const originally = new Date('2026-05-01T00:00:00.000Z');
      store.seedAllowance({ consumedSeconds: minutesToSeconds(20_000), exhaustedAt: originally });
      const session = store.seedSession({ startedAt: START });

      await meter.settle(session.sessionKey, { at: at(600), close: UsageCloseReason.LEFT });

      expect(store.allowance().exhaustedAt).toEqual(originally);
    });

    it('keeps metering a session that overruns the allowance rather than truncating it', async () => {
      // A live call is never cut off mid-sentence, so the total can pass
      // the granted minutes. It has to be recorded honestly.
      store.seedAllowance({ consumedSeconds: minutesToSeconds(20_000) - 10 });
      const session = store.seedSession({ startedAt: START });

      await meter.settle(session.sessionKey, { at: at(600), close: UsageCloseReason.LEFT });

      expect(store.allowance().consumedSeconds).toBe(minutesToSeconds(20_000) + 590);
    });
  });

  describe('module lifecycle', () => {
    it('runs the reaper on an interval sourced from configuration', () => {
      const setSpy = jest.spyOn(global, 'setInterval');
      const clearSpy = jest.spyOn(global, 'clearInterval');

      meter.onModuleInit();
      expect(setSpy).toHaveBeenCalledWith(expect.any(Function), 60_000);

      meter.onModuleDestroy();
      expect(clearSpy).toHaveBeenCalled();
      setSpy.mockRestore();
      clearSpy.mockRestore();
    });

    it('exposes the sweep interval so the gateway holds no second copy of it', () => {
      expect(meter.sweepIntervalMs).toBe(30_000);
    });
  });

  describe('product isolation', () => {
    it('settles a LIVE_STREAMING session into the LIVE_STREAMING allowance, never the RTC one', async () => {
      // The default seeded allowance (from beforeEach) is RTC/'ua_1'. A
      // second, independent allowance for the same user's LIVE_STREAMING
      // pool, and a session that draws against it specifically.
      const liveAllowance = store.seedAllowance({
        id: 'ua_live',
        product: UsageProduct.LIVE_STREAMING,
        includedMinutes: 6_000, // 100 hours, in minutes
        consumedSeconds: 0,
      });
      const session = store.seedSession({
        startedAt: START,
        allowanceId: liveAllowance.id,
        product: UsageProduct.LIVE_STREAMING,
        kind: UsageKind.LIVE_STREAMING_HOST_MINUTES,
      });

      await meter.settle(session.sessionKey, { at: at(600), close: UsageCloseReason.LEFT });

      expect(store.allowance('ua_live').consumedSeconds).toBe(600);
      // The RTC allowance this user also has is untouched.
      expect(store.allowance('ua_1').consumedSeconds).toBe(0);
    });
  });
});
