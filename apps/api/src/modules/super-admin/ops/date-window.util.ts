/**
 * Same UTC day/week boundary logic `OverviewService` already uses.
 * Duplicated here rather than imported: `overview.service.ts` doesn't
 * export these helpers, and this ops module isn't allowed to edit that
 * file (built by a sibling slice). Keep both in sync if the "week starts
 * on Monday" convention ever changes.
 */
export function startOfDayUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function startOfWeekUtc(now: Date): Date {
  const start = startOfDayUtc(now);
  const day = start.getUTCDay(); // 0 = Sunday ... 6 = Saturday
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  start.setUTCDate(start.getUTCDate() - daysSinceMonday);
  return start;
}

export function hoursAgo(now: Date, hours: number): Date {
  return new Date(now.getTime() - hours * 60 * 60 * 1000);
}

export function daysAgo(now: Date, days: number): Date {
  return hoursAgo(now, days * 24);
}
