import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsageKind, UsageSession } from '../../generated/prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { Environment } from '../../shared/environment/environment.constants';
import { UsageAllowanceService } from './usage-allowance.service';
import { minutesToSeconds, UsageCloseReason } from './usage.constants';

/** Everything needed to open a meter, all of it server-side state. */
export interface StartSessionInput {
  /** The gateway's own connection id. Never a client-supplied value. */
  sessionKey: string;
  projectId: string;
  environment: Environment;
  roomId: string;
  roomName: string;
  participantIdentity: string;
}

export interface SettlementResult {
  /** Seconds added to the allowance by this settlement. Zero when there was nothing new to count. */
  addedSeconds: number;
  /** The allowance's total after this settlement. */
  consumedSeconds: number;
  /** True if this settlement is the one that spent the allowance. */
  justExhausted: boolean;
}

/**
 * Records RTC consumption against developer allowances.
 *
 * # Why the client is never asked
 *
 * Every timestamp in here is the API's own clock, and `sessionKey` is the
 * connection id the signaling gateway generated for the WebSocket. A client
 * cannot report, shorten, or suppress its own usage: the only thing it
 * controls is when it disconnects, and a disconnect it never announces gets
 * closed by the reaper below.
 *
 * # Why it cannot double-count
 *
 * A session's consumption is always `settlementInstant - startedAt`, and
 * `UsageSession.meteredSeconds` is the high-water mark of how much of that
 * has already been credited. A settlement:
 *
 *   1. reads the session's current `meteredSeconds`,
 *   2. computes `delta = elapsed - meteredSeconds`, stopping if it is <= 0,
 *   3. moves `meteredSeconds` to `elapsed` with a compare-and-swap on the
 *      value it read, and
 *   4. adds exactly that `delta` to the allowance — in the same transaction
 *      as (3).
 *
 * Step 3 is what makes it safe. Two instances settling the same session
 * concurrently both compute a delta, but only one CAS matches; the loser
 * adds nothing and returns. Nothing is lost by losing, because the winner
 * already credited up to *its* instant and the next settlement recomputes
 * from `startedAt` regardless. Concurrent settlements of *different*
 * sessions sharing an allowance serialize on the allowance row inside
 * Postgres, since the increment is `consumed_seconds = consumed_seconds +
 * delta` in SQL rather than a read-modify-write in Node.
 *
 * # Why there is a sweep and a reaper
 *
 * Metering only at leave-time would lose every session whose instance died
 * mid-call. So each gateway settles the sessions it is holding on an
 * interval (`sweep`), which bounds a crash's loss to one interval, and a
 * `reap` pass closes sessions nobody has settled for `abandonedAfterMs` —
 * crediting them up to their last confirmed-alive instant, not to now.
 */
@Injectable()
export class UsageMeterService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UsageMeterService.name);
  private reaperTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly allowances: UsageAllowanceService,
  ) {}

  onModuleInit(): void {
    const intervalMs = this.configService.get<number>('usage.reaperIntervalMs')!;
    // Plain setInterval, same as RetentionService: a cron dependency for two
    // sweeps is not worth the addition.
    this.reaperTimer = setInterval(() => void this.runReaper(), intervalMs);
  }

  onModuleDestroy(): void {
    if (this.reaperTimer) clearInterval(this.reaperTimer);
  }

  /** How often a gateway should call `sweep`. Read from config so the caller holds no second copy. */
  get sweepIntervalMs(): number {
    return this.configService.get<number>('usage.meterIntervalMs')!;
  }

  /**
   * Opens the meter for one participant-session.
   *
   * Idempotent on `sessionKey`: a retried join, or a duplicate delivery of
   * the same join, returns the existing row and does not restart the clock.
   * The `create`-then-catch shape (rather than an upsert) is deliberate —
   * an upsert's `update` branch would have to be empty anyway, and this way
   * the common case is one insert.
   */
  async startSession(input: StartSessionInput): Promise<UsageSession> {
    const allowance = await this.allowances.ensureProvisionedForProject(input.projectId);

    const existing = await this.prisma.usageSession.findUnique({
      where: { sessionKey: input.sessionKey },
    });
    if (existing) {
      return existing;
    }

    const now = new Date();
    try {
      return await this.prisma.usageSession.create({
        data: {
          sessionKey: input.sessionKey,
          allowanceId: allowance.id,
          userId: allowance.userId,
          projectId: input.projectId,
          environment: input.environment,
          roomId: input.roomId,
          roomName: input.roomName,
          participantIdentity: input.participantIdentity,
          kind: UsageKind.RTC_PARTICIPANT_MINUTES,
          startedAt: now,
          lastMeteredAt: now,
        },
      });
    } catch (err) {
      // Two joins for the same connection id racing. The row the loser
      // wanted now exists, and it is the one to meter against.
      const raced = await this.prisma.usageSession.findUnique({
        where: { sessionKey: input.sessionKey },
      });
      if (raced) return raced;
      throw err;
    }
  }

  /**
   * Credits everything this session has accrued up to `at`, and optionally
   * closes it.
   *
   * `at` is a parameter rather than `new Date()` because the two callers
   * mean different instants. A clean leave settles up to now. The reaper
   * settles up to `lastMeteredAt` — the last moment the session was
   * observed alive — because crediting a session abandoned by a dead
   * gateway all the way to now would charge a developer for Livqeno's
   * outage.
   */
  async settle(
    sessionKey: string,
    options: { at?: Date; close?: UsageCloseReason } = {},
  ): Promise<SettlementResult | null> {
    const session = await this.prisma.usageSession.findUnique({ where: { sessionKey } });
    if (!session) {
      return null;
    }
    return this.settleRow(session, options);
  }

  /**
   * Settles the sessions one gateway is currently holding.
   *
   * Takes the keys the caller knows are alive rather than querying for live
   * rows, and that is the whole point: an instance may only settle sessions
   * whose sockets *it* holds. Query for "all live sessions" instead and
   * every instance would happily keep metering the sessions of an instance
   * that had crashed, which is precisely the usage the reaper exists to
   * bound honestly.
   */
  async sweep(sessionKeys: readonly string[]): Promise<number> {
    if (sessionKeys.length === 0) return 0;

    const at = new Date();
    let addedSeconds = 0;

    const sessions = await this.prisma.usageSession.findMany({
      where: { sessionKey: { in: [...sessionKeys] }, endedAt: null },
    });

    for (const session of sessions) {
      try {
        const result = await this.settleRow(session, { at });
        addedSeconds += result?.addedSeconds ?? 0;
      } catch (err) {
        // One failed row must not abandon the rest of the sweep; the next
        // pass recomputes from startedAt, so nothing is lost by skipping it.
        this.logger.warn(`usage sweep failed for session ${session.sessionKey}: ${(err as Error).message}`);
      }
    }

    return addedSeconds;
  }

  /**
   * Closes sessions no gateway has settled recently.
   *
   * Safe to run on every instance at once: `settleRow`'s compare-and-swap
   * makes a second reaper's pass a no-op, and the close itself is a
   * conditional update on `endedAt IS NULL`.
   */
  async reap(): Promise<{ closed: number; addedSeconds: number }> {
    const abandonedAfterMs = this.configService.get<number>('usage.abandonedAfterMs')!;
    const cutoff = new Date(Date.now() - abandonedAfterMs);

    const abandoned = await this.prisma.usageSession.findMany({
      where: { endedAt: null, lastMeteredAt: { lt: cutoff } },
      take: 500,
    });

    let closed = 0;
    let addedSeconds = 0;

    for (const session of abandoned) {
      try {
        const result = await this.settleRow(session, {
          at: session.lastMeteredAt,
          close: UsageCloseReason.ABANDONED,
        });
        addedSeconds += result?.addedSeconds ?? 0;
        closed += 1;
      } catch (err) {
        this.logger.warn(`usage reap failed for session ${session.sessionKey}: ${(err as Error).message}`);
      }
    }

    return { closed, addedSeconds };
  }

  /**
   * The single write path for consumption. Everything above funnels through
   * here so the compare-and-swap exists in exactly one place.
   */
  private async settleRow(
    session: UsageSession,
    options: { at?: Date; close?: UsageCloseReason },
  ): Promise<SettlementResult | null> {
    const at = options.at ?? new Date();

    // Floored, so a partial second is never credited, and clamped at zero:
    // a settlement instant before `startedAt` (a clock stepping backwards)
    // must read as "nothing yet", not as a negative credit.
    const elapsedSeconds = Math.max(0, Math.floor((at.getTime() - session.startedAt.getTime()) / 1000));
    const delta = elapsedSeconds - session.meteredSeconds;

    let result: SettlementResult | null = null;

    if (delta > 0) {
      result = await this.prisma.$transaction(async (tx) => {
        // Compare-and-swap on the value we read. Exactly one concurrent
        // settlement can move meteredSeconds from `session.meteredSeconds`
        // to `elapsedSeconds`, and only that one credits the difference.
        //
        // `endedAt: null` is part of the condition, not just the CAS value:
        // a closed session is final. Without it, a settlement arriving
        // after the close would credit the wall-clock time since — time
        // during which the participant was, by definition, gone. The close
        // below runs after this in the same call, so a settle-and-close
        // still credits its own delta.
        const { count } = await tx.usageSession.updateMany({
          where: { id: session.id, meteredSeconds: session.meteredSeconds, endedAt: null },
          data: { meteredSeconds: elapsedSeconds, lastMeteredAt: at },
        });

        if (count === 0) {
          // Someone else settled this session between our read and our
          // write. They credited their own delta; ours would double-count.
          return null;
        }

        const allowance = await tx.usageAllowance.update({
          where: { id: session.allowanceId },
          // `increment` compiles to `consumed_seconds = consumed_seconds +
          // $1`, so Postgres does the arithmetic under a row lock. Reading
          // the value into Node and writing back a total would lose
          // concurrent sessions' updates.
          data: { consumedSeconds: { increment: delta } },
        });

        const justExhausted =
          allowance.exhaustedAt === null && allowance.consumedSeconds >= minutesToSeconds(allowance.includedMinutes);

        if (justExhausted) {
          // Conditional on `exhaustedAt: null`, so the timestamp records
          // the first crossing and is never rewritten by a later one.
          await tx.usageAllowance.updateMany({
            where: { id: allowance.id, exhaustedAt: null },
            data: { exhaustedAt: at },
          });
        }

        return {
          addedSeconds: delta,
          consumedSeconds: allowance.consumedSeconds,
          justExhausted,
        };
      });

      if (result?.justExhausted) {
        this.logger.log(
          `usage allowance exhausted: user=${session.userId} project=${session.projectId} ` +
            `consumedSeconds=${result.consumedSeconds}`,
        );
      }
    } else if (options.at) {
      // Nothing new to credit, but the session is still alive and we have
      // just confirmed it: move `lastMeteredAt` so the reaper does not
      // mistake a sub-second-old session for an abandoned one.
      await this.prisma.usageSession.updateMany({
        where: { id: session.id, endedAt: null },
        data: { lastMeteredAt: at },
      });
    }

    if (options.close) {
      // Separate from the credit above, and conditional on `endedAt IS
      // NULL`, so the first close wins and a duplicate leave changes
      // nothing.
      await this.prisma.usageSession.updateMany({
        where: { id: session.id, endedAt: null },
        data: { endedAt: at, closeReason: options.close },
      });
    }

    return result;
  }

  private async runReaper(): Promise<void> {
    try {
      const { closed, addedSeconds } = await this.reap();
      if (closed > 0) {
        this.logger.log(`usage reaper: closed ${closed} abandoned sessions (+${addedSeconds}s)`);
      }
    } catch (err) {
      this.logger.error(`usage reaper failed: ${(err as Error).message}`);
    }
  }
}
