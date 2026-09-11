import { UsageAllowance, UsageKind, UsageSession } from '../../../generated/prisma/client';
import { Environment } from '../../../shared/environment/environment.constants';

/**
 * A tiny in-memory stand-in for the two usage tables.
 *
 * Metering's correctness is *entirely* about read-then-conditional-write
 * ordering — the compare-and-swap in `UsageMeterService.settleRow`, the
 * `endedAt IS NULL` close, the `exhaustedAt IS NULL` stamp. Asserting on
 * `jest.fn()` calls proves the calls were made; it cannot prove that
 * settling twice counts once, which is the property that matters. So the
 * tests get real state to act on instead.
 *
 * It implements exactly the query shapes `UsageMeterService` uses and
 * nothing more: `matches()` below understands scalar equality, `null`,
 * `{ in }` and `{ lt }`, because those are all the service asks for. A new
 * query shape in the service throws here rather than silently matching
 * everything — a fake that quietly over-matches is worse than no fake.
 *
 * What it does *not* model is real concurrency. Postgres row locks are what
 * make the increment safe under genuinely parallel writers; that is proved
 * against a real database in test/usage-metering.e2e-spec.ts. What this
 * models is interleaving: two settlements that both read before either
 * writes, which is the case the compare-and-swap exists for.
 */
export class FakeUsageStore {
  readonly allowances = new Map<string, UsageAllowance>();
  readonly sessions = new Map<string, UsageSession>();
  private sequence = 0;

  /** Counts `$transaction` callbacks, so a test can prove the credit path is transactional. */
  transactions = 0;

  seedAllowance(overrides: Partial<UsageAllowance> = {}): UsageAllowance {
    const allowance: UsageAllowance = {
      id: 'ua_1',
      userId: 'u_1',
      product: 'RTC' as UsageAllowance['product'],
      source: 'FREE_TIER' as UsageAllowance['source'],
      includedMinutes: 20_000,
      consumedSeconds: 0,
      includedCount: null,
      consumedCount: 0,
      exhaustedAt: null,
      grantedAt: new Date('2026-01-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      ...overrides,
    };
    this.allowances.set(allowance.id, allowance);
    return allowance;
  }

  seedSession(overrides: Partial<UsageSession> = {}): UsageSession {
    this.sequence += 1;
    const startedAt = overrides.startedAt ?? new Date('2026-06-01T10:00:00.000Z');
    const session: UsageSession = {
      id: `us_${this.sequence}`,
      sessionKey: `conn_${this.sequence}`,
      allowanceId: 'ua_1',
      userId: 'u_1',
      projectId: 'p_1',
      environment: Environment.DEVELOPMENT,
      roomId: 'r_1',
      roomName: 'lobby',
      participantIdentity: 'alice',
      product: 'RTC' as UsageSession['product'],
      kind: UsageKind.RTC_PARTICIPANT_MINUTES,
      startedAt,
      meteredSeconds: 0,
      lastMeteredAt: startedAt,
      endedAt: null,
      closeReason: null,
      createdAt: startedAt,
      updatedAt: startedAt,
      ...overrides,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  session(id: string): UsageSession {
    const row = this.sessions.get(id);
    if (!row) throw new Error(`no session ${id}`);
    return row;
  }

  allowance(id = 'ua_1'): UsageAllowance {
    const row = this.allowances.get(id);
    if (!row) throw new Error(`no allowance ${id}`);
    return row;
  }

  /** The object to hand `UsageMeterService` in place of PrismaService. */
  asPrisma() {
    // Arrow functions throughout, so `this` inside them is the store — no
    // alias needed, and no way for a delegate to be called unbound.
    const client = {
      $transaction: async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => {
        this.transactions += 1;
        return cb(client);
      },
      usageSession: {
        findUnique: async ({ where }: { where: Record<string, unknown> }) => this.findSession(where) ?? null,
        findMany: async ({ where, take }: { where: Record<string, unknown>; take?: number }) => {
          const rows = [...this.sessions.values()].filter((row) => matchesAll(row, where));
          return take ? rows.slice(0, take) : rows;
        },
        create: async ({ data }: { data: Record<string, unknown> }) => {
          if (this.findSession({ sessionKey: data.sessionKey })) {
            // Prisma's unique-violation shape, so the service's race
            // handling is exercised rather than bypassed.
            throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
          }
          return this.seedSession(data as Partial<UsageSession>);
        },
        updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          let count = 0;
          for (const [id, row] of this.sessions) {
            if (!matchesAll(row, where)) continue;
            this.sessions.set(id, applyData(row, data));
            count += 1;
          }
          return { count };
        },
      },
      usageAllowance: {
        // One allowance per (userId, product) now — Prisma names the
        // composite-unique where clause `userId_product`.
        upsert: async ({
          where,
          create,
        }: {
          where: { userId_product: { userId: string; product: string } };
          create: Record<string, unknown>;
        }) => {
          const { userId, product } = where.userId_product;
          const existing = [...this.allowances.values()].find(
            (row) => row.userId === userId && row.product === product,
          );
          if (existing) return existing;
          return this.seedAllowance({
            id: `ua_${userId}_${product}`,
            ...(create as Partial<UsageAllowance>),
          });
        },
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = this.allowance(where.id);
          const next = applyData(row, data);
          this.allowances.set(where.id, next);
          return next;
        },
        updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          let count = 0;
          for (const [id, row] of this.allowances) {
            if (!matchesAll(row, where)) continue;
            this.allowances.set(id, applyData(row, data));
            count += 1;
          }
          return { count };
        },
      },
      project: {
        findUnique: async () => ({ ownerId: 'u_1' }),
      },
    };
    return client;
  }

  private findSession(where: Record<string, unknown>): UsageSession | undefined {
    return [...this.sessions.values()].find((row) => matchesAll(row, where));
  }
}

function matchesAll(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, expected]) => matches(row[key], expected));
}

function matches(actual: unknown, expected: unknown): boolean {
  if (expected === null) return actual === null;
  if (expected instanceof Date) return actual instanceof Date && actual.getTime() === expected.getTime();
  if (typeof expected === 'object') {
    const filter = expected as Record<string, unknown>;
    if ('in' in filter) return (filter.in as unknown[]).includes(actual);
    if ('lt' in filter) return actual instanceof Date && actual.getTime() < (filter.lt as Date).getTime();
    throw new Error(`FakeUsageStore does not implement the filter ${JSON.stringify(expected)}`);
  }
  return actual === expected;
}

function applyData<T extends Record<string, unknown>>(row: T, data: Record<string, unknown>): T {
  const next = { ...row } as Record<string, unknown>;
  for (const [key, value] of Object.entries(data)) {
    if (value !== null && typeof value === 'object' && !(value instanceof Date) && 'increment' in value) {
      next[key] = (next[key] as number) + (value as { increment: number }).increment;
      continue;
    }
    next[key] = value;
  }
  return next as T;
}
