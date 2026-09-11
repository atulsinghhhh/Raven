import { ConfigService } from '@nestjs/config';
import { ADMISSION_LANE, AdmissionControlService } from './admission-control.service';
import { CapacityExceededError } from '../errors/app-error';

/**
 * The admission ceiling itself, with no database anywhere near it.
 *
 * `test/live-streams-capacity.e2e-spec.ts` proves the *outcome* — that a
 * hundred simultaneous viewer mints stop coming back as
 * `500 RAVEN_INTERNAL_ERROR` — but it needs Postgres and Redis, so it runs
 * only where those exist. These cover the mechanism: what is admitted, what
 * queues, what is refused, and above all that a slot is always given back.
 *
 * A leaked slot is the failure mode worth fearing here. It does not throw
 * or log; the lane just gets quietly narrower until it admits nothing, and
 * the symptom is an endpoint that 503s forever while the database sits idle.
 * So several of these assert on `stats()` after the fact rather than on the
 * call's own result.
 */
const LANE = ADMISSION_LANE.CREDENTIAL_MINT;

/** A ConfigService stub holding one set of lane limits. */
function configWith(limits: { concurrency?: number; queueDepth?: number; queueTimeoutMs?: number }): ConfigService {
  const values: Record<string, unknown> = {
    'capacity.concurrency': limits.concurrency,
    'capacity.queueDepth': limits.queueDepth,
    'capacity.queueTimeoutMs': limits.queueTimeoutMs,
  };
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

/** A promise plus the handles to settle it from outside. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Lets every microtask already scheduled run.
 *
 * Needed because admission hands a released slot to the next waiter within
 * the same turn, so "has the queue moved yet" is only answerable after the
 * pending continuations have drained.
 */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('AdmissionControlService', () => {
  describe('within the ceiling', () => {
    it('runs work immediately and returns its value untouched', async () => {
      const service = new AdmissionControlService(configWith({ concurrency: 2, queueDepth: 0 }));

      await expect(service.run(LANE, async () => 'minted')).resolves.toBe('minted');
    });

    it('admits up to concurrency at once', async () => {
      const service = new AdmissionControlService(configWith({ concurrency: 3, queueDepth: 0 }));
      const gate = deferred();

      const inFlight = [1, 2, 3].map(() => service.run(LANE, () => gate.promise));
      await settle();

      expect(service.stats()[0]).toMatchObject({ inFlight: 3, waiting: 0, shed: 0 });

      gate.resolve();
      await Promise.all(inFlight);
    });

    it('gives the slot back after the work resolves', async () => {
      const service = new AdmissionControlService(configWith({ concurrency: 1, queueDepth: 0 }));

      await service.run(LANE, async () => 'first');
      await service.run(LANE, async () => 'second');

      // Two sequential requests through a one-wide lane only work if the
      // first slot came back.
      expect(service.stats()[0]).toMatchObject({ inFlight: 0, admitted: 2, shed: 0 });
    });

    it('gives the slot back when the work throws', async () => {
      const service = new AdmissionControlService(configWith({ concurrency: 1, queueDepth: 0 }));

      await expect(service.run(LANE, () => Promise.reject(new Error('stream not found')))).rejects.toThrow(
        'stream not found',
      );

      // The handler's own failure must not narrow the lane. This is the
      // leak that would turn one bad request into a permanently 503ing
      // endpoint.
      expect(service.stats()[0]).toMatchObject({ inFlight: 0 });
      await expect(service.run(LANE, async () => 'still works')).resolves.toBe('still works');
    });

    it("passes the caller's own error through unchanged", async () => {
      const service = new AdmissionControlService(configWith({ concurrency: 1, queueDepth: 0 }));
      const original = new Error('conversation missing');

      // Being admitted through a ceiling must not rewrite what a handler
      // failed with, or every error in the API would start looking like a
      // capacity problem.
      await expect(service.run(LANE, () => Promise.reject(original))).rejects.toBe(original);
    });
  });

  describe('the queue', () => {
    it('holds a burst inside the ceiling rather than refusing it', async () => {
      const service = new AdmissionControlService(configWith({ concurrency: 2, queueDepth: 10 }));
      const gate = deferred();

      const all = Array.from({ length: 8 }, () => service.run(LANE, () => gate.promise));
      await settle();

      // This is the property that matters for a thundering herd: the burst
      // is *served*, two at a time, not shed.
      expect(service.stats()[0]).toMatchObject({ inFlight: 2, waiting: 6, shed: 0 });

      gate.resolve();
      await expect(Promise.all(all)).resolves.toHaveLength(8);
      expect(service.stats()[0]).toMatchObject({ inFlight: 0, waiting: 0, shed: 0, admitted: 8 });
    });

    it('admits waiters in arrival order', async () => {
      const service = new AdmissionControlService(configWith({ concurrency: 1, queueDepth: 5 }));
      const started: number[] = [];
      const gate = deferred();

      const all = [0, 1, 2, 3].map((index) =>
        service.run(LANE, async () => {
          started.push(index);
          await gate.promise;
        }),
      );
      await settle();
      gate.resolve();
      await Promise.all(all);

      // FIFO, not LIFO. A stack would starve the oldest request in the
      // queue, which is the one closest to the caller's own timeout.
      expect(started).toEqual([0, 1, 2, 3]);
    });

    it('hands a released slot straight to the next waiter', async () => {
      const service = new AdmissionControlService(configWith({ concurrency: 1, queueDepth: 5 }));
      const first = deferred();
      const second = deferred();

      const a = service.run(LANE, () => first.promise);
      const b = service.run(LANE, () => second.promise);
      await settle();
      expect(service.stats()[0]).toMatchObject({ inFlight: 1, waiting: 1 });

      first.resolve();
      await a;
      await settle();

      // A released slot must not sit idle while somebody is queued for it.
      expect(service.stats()[0]).toMatchObject({ inFlight: 1, waiting: 0 });
      second.resolve();
      await b;
    });
  });

  describe('past the queue', () => {
    it('refuses with CapacityExceededError once the lane and queue are both full', async () => {
      const service = new AdmissionControlService(configWith({ concurrency: 1, queueDepth: 1 }));
      const gate = deferred();

      const admitted = service.run(LANE, () => gate.promise);
      const queued = service.run(LANE, () => gate.promise);
      await settle();

      await expect(service.run(LANE, async () => 'third')).rejects.toBeInstanceOf(CapacityExceededError);

      gate.resolve();
      await Promise.all([admitted, queued]);
    });

    it('refuses immediately rather than after a timeout', async () => {
      const service = new AdmissionControlService(
        configWith({ concurrency: 1, queueDepth: 0, queueTimeoutMs: 30_000 }),
      );
      const gate = deferred();
      const admitted = service.run(LANE, () => gate.promise);
      await settle();

      const startedAt = Date.now();
      await expect(service.run(LANE, async () => 'shed')).rejects.toBeInstanceOf(CapacityExceededError);

      // The whole point of shedding rather than queueing. A 503 in two
      // milliseconds is the difference between a client that retries into a
      // recovering service and one that piles more sockets onto a saturated
      // one — and it must not wait out queueTimeoutMs to say so.
      expect(Date.now() - startedAt).toBeLessThan(1_000);

      gate.resolve();
      await admitted;
    });

    it('answers 503 with a retry hint and the limit, and leaks nothing internal', async () => {
      const service = new AdmissionControlService(configWith({ concurrency: 1, queueDepth: 0 }));
      const gate = deferred();
      const admitted = service.run(LANE, () => gate.promise);
      await settle();

      let err!: CapacityExceededError;
      try {
        await service.run(LANE, async () => 'shed');
      } catch (caught) {
        err = caught as CapacityExceededError;
      }

      expect(err.getStatus()).toBe(503);
      expect(err.getResponse()).toMatchObject({
        code: 'RAVEN_CAPACITY_EXCEEDED',
        retryAfterSeconds: 1,
        limit: 1,
      });
      // Not 429: the limit is ours, not the caller's, and a developer
      // debugging a 429 goes looking at their own call rate instead.
      expect(err.getStatus()).not.toBe(429);

      const body = JSON.stringify(err.getResponse());
      expect(body).not.toMatch(/postgres|redis|password|@|DATABASE_URL/i);

      gate.resolve();
      await admitted;
    });

    it('counts what it shed, so an operator can see the ceiling being hit', async () => {
      const service = new AdmissionControlService(configWith({ concurrency: 1, queueDepth: 0 }));
      const gate = deferred();
      const admitted = service.run(LANE, () => gate.promise);
      await settle();

      await Promise.allSettled([
        service.run(LANE, async () => 1),
        service.run(LANE, async () => 2),
        service.run(LANE, async () => 3),
      ]);

      expect(service.stats()[0]).toMatchObject({ name: LANE, concurrency: 1, queueDepth: 0, shed: 3 });

      gate.resolve();
      await admitted;
    });

    it('recovers as soon as the burst clears', async () => {
      const service = new AdmissionControlService(configWith({ concurrency: 1, queueDepth: 0 }));
      const gate = deferred();
      const admitted = service.run(LANE, () => gate.promise);
      await settle();

      await expect(service.run(LANE, async () => 'shed')).rejects.toBeInstanceOf(CapacityExceededError);

      gate.resolve();
      await admitted;

      // A shed request is a momentary answer, not a latch. The next caller
      // gets straight through.
      await expect(service.run(LANE, async () => 'through')).resolves.toBe('through');
    });
  });

  describe('the queue deadline', () => {
    it('refuses a waiter that sat longer than queueTimeoutMs', async () => {
      jest.useFakeTimers();
      try {
        const service = new AdmissionControlService(configWith({ concurrency: 1, queueDepth: 5, queueTimeoutMs: 100 }));
        const gate = deferred();
        const admitted = service.run(LANE, () => gate.promise);
        const queued = service.run(LANE, async () => 'never runs');
        await Promise.resolve();

        jest.advanceTimersByTime(101);
        await expect(queued).rejects.toBeInstanceOf(CapacityExceededError);
        expect(service.stats()[0]).toMatchObject({ timedOut: 1, waiting: 0 });

        gate.resolve();
        await admitted;
      } finally {
        jest.useRealTimers();
      }
    });

    it('tells a timed-out caller to wait at least as long as it just lost', async () => {
      jest.useFakeTimers();
      try {
        const service = new AdmissionControlService(
          configWith({ concurrency: 1, queueDepth: 5, queueTimeoutMs: 2_500 }),
        );
        const gate = deferred();
        const admitted = service.run(LANE, () => gate.promise);
        const queued = service.run(LANE, async () => 'never runs');
        await Promise.resolve();

        jest.advanceTimersByTime(2_501);
        let err!: CapacityExceededError;
        try {
          await queued;
        } catch (caught) {
          err = caught as CapacityExceededError;
        }

        // Rounded up from 2.5s, so a client never retries before the wait
        // it just lost could plausibly have cleared.
        expect(err.getResponse()).toMatchObject({ retryAfterSeconds: 3 });

        gate.resolve();
        await admitted;
      } finally {
        jest.useRealTimers();
      }
    });

    it('does not refuse a waiter that was admitted before its deadline', async () => {
      jest.useFakeTimers();
      try {
        const service = new AdmissionControlService(
          configWith({ concurrency: 1, queueDepth: 5, queueTimeoutMs: 1_000 }),
        );
        const gate = deferred();
        const admitted = service.run(LANE, () => gate.promise);
        const queued = service.run(LANE, async () => 'ran');
        await Promise.resolve();

        gate.resolve();
        await admitted;
        await expect(queued).resolves.toBe('ran');

        // The timer has to have been cleared, not merely lost the race: an
        // armed timer would settle an already-resolved waiter and, worse,
        // keep the process alive past the request.
        jest.advanceTimersByTime(5_000);
        expect(service.stats()[0]).toMatchObject({ timedOut: 0, admitted: 2 });
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('configuration', () => {
    it('falls back to safe literals when no capacity config exists at all', () => {
      // A ConfigService with no `capacity` block used to produce
      // Math.max(1, undefined) === NaN, and a lane with a NaN ceiling
      // admits nothing forever: `inFlight >= NaN` is false, so everything
      // queues, and `waiting.length >= NaN` is false too, so nothing sheds.
      const service = new AdmissionControlService({ get: () => undefined } as unknown as ConfigService);

      void service.run(LANE, async () => 'x');

      const lane = service.stats()[0];
      expect(Number.isNaN(lane.concurrency)).toBe(false);
      expect(Number.isNaN(lane.queueDepth)).toBe(false);
      expect(lane.concurrency).toBeGreaterThanOrEqual(1);
    });

    it('prefers a per-lane override over the shared default', async () => {
      const service = new AdmissionControlService({
        get: (key: string) => {
          if (key === `capacity.lanes.${LANE}.concurrency`) return 7;
          if (key === 'capacity.concurrency') return 2;
          if (key === 'capacity.queueDepth') return 0;
          return undefined;
        },
      } as unknown as ConfigService);

      await service.run(LANE, async () => 'x');

      expect(service.stats()[0].concurrency).toBe(7);
    });

    it('keeps a lane at the limits it started with', async () => {
      // Resolved once, on first use. Re-reading per request would let a
      // ceiling change underneath the requests already queued against it.
      let concurrency = 2;
      const service = new AdmissionControlService({
        get: (key: string) =>
          key === 'capacity.concurrency' ? concurrency : key === 'capacity.queueDepth' ? 0 : undefined,
      } as unknown as ConfigService);

      await service.run(LANE, async () => 'x');
      concurrency = 99;
      await service.run(LANE, async () => 'y');

      expect(service.stats()[0].concurrency).toBe(2);
    });
  });

  describe('lane isolation', () => {
    it('keeps one lane full from starving another', async () => {
      // Per-operation rather than per-process on purpose: a burst of viewer
      // credentials must not be able to starve the endpoints an operator
      // needs in order to *notice* the burst.
      const service = new AdmissionControlService(configWith({ concurrency: 1, queueDepth: 0 }));
      const gate = deferred();

      const admitted = service.run(LANE, () => gate.promise);
      await settle();
      await expect(service.run(LANE, async () => 'shed')).rejects.toBeInstanceOf(CapacityExceededError);

      // A different lane name is a different ceiling entirely.
      await expect(service.run('some-other-lane' as never, async () => 'fine')).resolves.toBe('fine');

      gate.resolve();
      await admitted;
      expect(service.stats()).toHaveLength(2);
    });
  });
});
