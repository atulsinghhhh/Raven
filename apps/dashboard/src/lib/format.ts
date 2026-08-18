/**
 * Shared formatters. Everything is deterministic given its input and
 * uses a fixed en-GB-ish locale rather than the ambient one — these run
 * in server components, and a server/client locale mismatch produces
 * hydration errors that only show up on someone else's machine.
 */

const DATE_TIME = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const DATE_ONLY = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

const CLOCK = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : DATE_TIME.format(d);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : DATE_ONLY.format(d);
}

export function formatClockTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : CLOCK.format(d);
}

/** "18m 42s" — the format used for connection durations everywhere. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${seconds}s`;
}

/** Compact relative time for "last seen" style columns. */
export function formatRelative(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';

  const diff = now - then;
  if (diff < 0) return 'just now';

  const seconds = Math.floor(diff / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}

export function formatPercent(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return `${value}%`;
}

/** Thousands separators, so 12400 doesn't read as 124 00 at a glance. */
export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('en-GB').format(value);
}

export const RANGES = ['15m', '1h', '24h', '7d'] as const;
export type Range = (typeof RANGES)[number];

/**
 * Only these four windows exist server-side (MetricsService.RANGE_MS).
 * Anything else silently falls back to 1h there, which would make the UI
 * lie about what it's showing — so unknown values are normalised here.
 */
export function normaliseRange(raw: string | undefined): Range {
  return (RANGES as readonly string[]).includes(raw ?? '') ? (raw as Range) : '1h';
}

export const RANGE_LABEL: Record<Range, string> = {
  '15m': 'Last 15 minutes',
  '1h': 'Last hour',
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
};

export const RANGE_SHORT: Record<Range, string> = {
  '15m': '15m',
  '1h': '1h',
  '24h': '24h',
  '7d': '7d',
};

export const RANGE_MS: Record<Range, number> = {
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};
