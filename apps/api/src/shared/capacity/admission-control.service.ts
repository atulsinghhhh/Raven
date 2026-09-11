import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CapacityExceededError } from '../errors/app-error';

/**
 * One admission lane: what is running, and what is waiting to run.
 *
 * A lane is per-operation rather than per-process, so a burst of viewer
 * credentials cannot starve the endpoints an operator needs in order to
 * *notice* the burst.
 */
interface Lane {
  readonly name: string;
  readonly concurrency: number;
  readonly queueDepth: number;
  readonly queueTimeoutMs: number;
  inFlight: number;
  waiting: Waiter[];
  /** Cumulative, for /metrics and for the capacity report's numbers. */
  admitted: number;
  queued: number;
  shed: number;
  timedOut: number;
}

interface Waiter {
  resolve: () => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
  /** Set once the waiter has been settled, so a race cannot settle it twice. */
  settled: boolean;
}

export interface LaneOptions {
  concurrency: number;
  queueDepth: number;
  queueTimeoutMs: number;
}

export interface LaneStats {
  name: string;
  concurrency: number;
  queueDepth: number;
  inFlight: number;
  waiting: number;
  admitted: number;
  queued: number;
  shed: number;
  timedOut: number;
}

/**
 * Bounded admission control for database-heavy request paths.
 *
 * # The problem it solves
 *
 * Livqeno's credential-mint endpoints are the most concurrency-exposed
 * surface it has: one call per viewer arriving, and they all arrive in the
 * seconds after a host goes live. Each one is a handful of sequential
 * queries, so each takes a connection out of one pool of
 * `DATABASE_POOL_MAX` for a moment at a time.
 *
 * Nothing used to bound how many of those ran at once. A hundred
 * simultaneous mints therefore did not fail at the mint — they failed
 * *inside the pool*, where the only limit was
 * `DATABASE_POOL_CONNECTION_TIMEOUT_MS`, and a connection acquisition that
 * gives up surfaces as an error the exception filter has never heard of.
 * The caller got `500 RAVEN_INTERNAL_ERROR`; the process stayed wedged
 * afterwards, because the backlog outlived the requests that made it.
 *
 * # What it does instead
 *
 * Admit up to `concurrency`. Hold up to `queueDepth` more, each with its
 * own deadline. Refuse anything past that immediately, with
 * `503 RAVEN_CAPACITY_EXCEEDED` and a `retryAfterSeconds` a client can act
 * on.
 *
 * Three properties are worth being explicit about, because each one is a
 * decision rather than an accident:
 *
 * - **Refusal is instant.** A caller past the queue is told *now*, not
 *   after a timeout. A 503 in two milliseconds is a far better answer than
 *   a 503 in five seconds, and it is the difference between a client that
 *   retries into a recovering service and one that piles more sockets onto
 *   a saturated one.
 * - **The queue is bounded and the wait is bounded.** An unbounded queue is
 *   just the pg pool's failure mode again, one layer up. A bounded one
 *   converts overload into a decision instead of latency.
 * - **The default ceiling is derived, not invented.** See
 *   `configuration.ts`'s `capacity` block: the concurrency default *is*
 *   `DATABASE_POOL_MAX`, because admitting more concurrent database-heavy
 *   requests than the pool has connections is precisely how the surplus
 *   ends up queueing somewhere that fails as a 500. It is a real ceiling
 *   with a reason, not a small number chosen to make a test pass.
 *
 * # What it is not
 *
 * It is not a rate limiter. `RateLimitGuard` caps how often one *caller*
 * may ask, over a window, and rejects with 429. This caps how much work
 * this *process* does at once, and rejects with 503. A deployment wants
 * both, and they are not substitutes: the limiter cannot see that ten
 * different keys have each sent a polite ten requests at the same instant.
 */
@Injectable()
export class AdmissionControlService {
  private readonly logger = new Logger(AdmissionControlService.name);
  private readonly lanes = new Map<string, Lane>();

  constructor(private readonly configService: ConfigService) {}

  /**
   * Runs `work` under the named lane's ceiling, or refuses.
   *
   * Throws `CapacityExceededError` when the lane and its queue are both
   * full, or when this request waited longer than the lane's deadline.
   * Anything `work` itself throws passes straight through, so a caller's
   * own error handling is unaffected by being admitted through here.
   */
  async run<T>(laneName: string, work: () => Promise<T>): Promise<T> {
    const lane = this.laneFor(laneName);

    if (lane.inFlight >= lane.concurrency) {
      await this.waitForSlot(lane);
    }

    lane.inFlight++;
    lane.admitted++;
    try {
      return await work();
    } finally {
      lane.inFlight--;
      // Hand the slot on inside the same turn, so a released slot is never
      // idle while somebody is queued for it.
      this.release(lane);
    }
  }

  /** Per-lane counters, for /metrics and for the capacity report. */
  stats(): LaneStats[] {
    return Array.from(this.lanes.values()).map((lane) => ({
      name: lane.name,
      concurrency: lane.concurrency,
      queueDepth: lane.queueDepth,
      inFlight: lane.inFlight,
      waiting: lane.waiting.length,
      admitted: lane.admitted,
      queued: lane.queued,
      shed: lane.shed,
      timedOut: lane.timedOut,
    }));
  }

  private waitForSlot(lane: Lane): Promise<void> {
    if (lane.waiting.length >= lane.queueDepth) {
      lane.shed++;
      // Logged at warn, once per shed request, with the numbers an operator
      // needs to decide whether to raise the ceiling or add an instance.
      // Not throttled: a shed request is rare by construction, and a burst
      // of these lines *is* the signal.
      this.logger.warn(
        `shedding a ${lane.name} request: ${lane.inFlight}/${lane.concurrency} in flight, ` +
          `queue full at ${lane.waiting.length}/${lane.queueDepth} ` +
          `(shed ${lane.shed} total)`,
      );
      throw new CapacityExceededError(this.describe(lane.name), {
        retryAfterSeconds: 1,
        limit: lane.concurrency,
      });
    }

    lane.queued++;
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        settled: false,
        timer: setTimeout(() => {
          if (waiter.settled) {
            return;
          }
          waiter.settled = true;
          lane.waiting = lane.waiting.filter((candidate) => candidate !== waiter);
          lane.timedOut++;
          this.logger.warn(
            `a queued ${lane.name} request waited longer than ${lane.queueTimeoutMs}ms and was refused ` +
              `(${lane.inFlight}/${lane.concurrency} in flight, ${lane.timedOut} timed out in total)`,
          );
          reject(
            new CapacityExceededError(this.describe(lane.name), {
              // Rounded up, so a client never retries before the wait it
              // just lost could plausibly have cleared.
              retryAfterSeconds: Math.max(1, Math.ceil(lane.queueTimeoutMs / 1000)),
              limit: lane.concurrency,
            }),
          );
        }, lane.queueTimeoutMs),
      };
      lane.waiting.push(waiter);
    });
  }

  private release(lane: Lane): void {
    const next = lane.waiting.shift();
    if (!next || next.settled) {
      return;
    }
    next.settled = true;
    clearTimeout(next.timer);
    next.resolve();
  }

  private laneFor(name: string): Lane {
    const existing = this.lanes.get(name);
    if (existing) {
      return existing;
    }

    const options = this.optionsFor(name);
    const lane: Lane = {
      name,
      concurrency: options.concurrency,
      queueDepth: options.queueDepth,
      queueTimeoutMs: options.queueTimeoutMs,
      inFlight: 0,
      waiting: [],
      admitted: 0,
      queued: 0,
      shed: 0,
      timedOut: 0,
    };
    this.lanes.set(name, lane);
    this.logger.log(
      `admission lane "${name}": concurrency=${lane.concurrency} queueDepth=${lane.queueDepth} ` +
        `queueTimeoutMs=${lane.queueTimeoutMs}`,
    );
    return lane;
  }

  /**
   * A lane's limits, read from config under `capacity.lanes.<name>` with
   * the shared `capacity` defaults behind it.
   *
   * Resolved once per lane, on first use, and then fixed for the process's
   * lifetime. Re-reading config per request would let a lane's ceiling
   * change underneath the requests already queued against it.
   */
  private optionsFor(name: string): LaneOptions {
    // Three tiers, most specific first, and the literal fallback last.
    // The fallback is not decoration: a ConfigService with no `capacity`
    // block at all — which is every unit test that builds this service
    // with a stub — would otherwise yield `undefined`, and
    // `Math.max(1, undefined)` is `NaN`. A lane with a NaN ceiling admits
    // nothing at all, because `inFlight >= NaN` is false forever and
    // `waiting.length >= NaN` is too, so every request would queue and
    // then time out.
    const scoped = <T>(key: string, fallback: T): T =>
      this.configService.get<T>(`capacity.lanes.${name}.${key}`) ??
      this.configService.get<T>(`capacity.${key}`) ??
      fallback;

    return {
      concurrency: Math.max(1, scoped('concurrency', 10)),
      queueDepth: Math.max(0, scoped('queueDepth', 0)),
      queueTimeoutMs: Math.max(1, scoped('queueTimeoutMs', 1000)),
    };
  }

  /** Turns a lane name into something a developer reading a 503 body can act on. */
  private describe(name: string): string {
    switch (name) {
      case ADMISSION_LANE.CREDENTIAL_MINT:
        return 'Minting RTC/chat credentials';
      default:
        return name;
    }
  }
}

/**
 * The lanes that exist. A string union rather than free-form names, so a
 * typo cannot silently create a third lane with default limits nobody
 * configured.
 */
export const ADMISSION_LANE = {
  /**
   * Every endpoint that mints a credential against the database: RTC
   * tokens, live-stream host credentials, live-stream viewer credentials.
   *
   * One lane for all three on purpose. They share the pool they contend
   * for, so giving each its own ceiling would let three lanes at their
   * individual limits add up to more concurrent database work than the pool
   * can serve — which is the exact failure this exists to prevent.
   */
  CREDENTIAL_MINT: 'credential-mint',
} as const;

export type AdmissionLane = (typeof ADMISSION_LANE)[keyof typeof ADMISSION_LANE];
