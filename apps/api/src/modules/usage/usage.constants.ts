/**
 * Usage metering constants. The allowance *size* is not here on purpose:
 * it lives on the `UsageAllowance` row (seeded from `usage.freeTierMinutes`
 * in configuration.ts), because a developer's entitlement is data, not a
 * constant the code can drift from. See docs/usage-metering.md.
 */

/** Seconds in a minute, named so the conversions below read as intent. */
export const SECONDS_PER_MINUTE = 60;

/**
 * Why a metered session stopped. Written to `UsageSession.closeReason` and
 * surfaced verbatim in the dashboard's history, so a developer can tell a
 * clean hang-up from a session Livqeno had to reap.
 */
export const UsageCloseReason = {
  /** The participant left, or their socket closed and the gateway cleaned up. */
  LEFT: 'left',
  /**
   * No gateway settled this session inside `usage.abandonedAfterMs`, so its
   * instance is presumed dead. Metered only up to `lastMeteredAt` — the last
   * instant the session was known to be alive.
   */
  ABANDONED: 'abandoned',
  /** The process is shutting down and settled its live sessions on the way out. */
  SHUTDOWN: 'shutdown',
} as const;

export type UsageCloseReason = (typeof UsageCloseReason)[keyof typeof UsageCloseReason];

/**
 * How many history rows a single list request can return.
 *
 * Capped rather than paginated for now: a cursor contract is worth adding
 * when someone needs page two, and worth not inventing before that.
 */
export const USAGE_HISTORY_MAX_LIMIT = 200;
export const USAGE_HISTORY_DEFAULT_LIMIT = 50;

/** Days of daily rollup the dashboard's usage chart asks for by default. */
export const USAGE_DAILY_DEFAULT_DAYS = 30;
export const USAGE_DAILY_MAX_DAYS = 365;

/** Whole minutes from a second count, rounding down: never bill a partial minute up. */
export function secondsToMinutes(seconds: number): number {
  return Math.floor(seconds / SECONDS_PER_MINUTE);
}

export function minutesToSeconds(minutes: number): number {
  return minutes * SECONDS_PER_MINUTE;
}
