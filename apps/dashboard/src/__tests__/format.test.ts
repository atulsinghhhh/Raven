import {
  formatBitrate,
  formatCount,
  formatDuration,
  formatMs,
  formatPercent,
  formatRelative,
  normaliseRange,
  RANGES,
} from '@/lib/format';

describe('formatDuration', () => {
  it('renders sub-minute durations in seconds', () => {
    expect(formatDuration(4_000)).toBe('4s');
    expect(formatDuration(59_000)).toBe('59s');
  });

  it('renders minutes and seconds', () => {
    expect(formatDuration(62_000)).toBe('1m 2s');
    expect(formatDuration(18 * 60_000 + 42_000)).toBe('18m 42s');
  });

  it('drops to hours and minutes for long connections', () => {
    expect(formatDuration(3 * 3_600_000 + 25 * 60_000)).toBe('3h 25m');
  });

  // A connection that never completed has a null duration: it must not
  // render as "0s", which would read as an instant disconnect.
  it('renders an em dash for null/undefined rather than zero', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(undefined)).toBe('—');
  });
});

describe('formatRelative', () => {
  const now = Date.parse('2026-08-18T12:00:00.000Z');

  it('collapses very recent timestamps to "just now"', () => {
    expect(formatRelative('2026-08-18T11:59:40.000Z', now)).toBe('just now');
  });

  it('steps through minutes, hours, and days', () => {
    expect(formatRelative('2026-08-18T11:30:00.000Z', now)).toBe('30m ago');
    expect(formatRelative('2026-08-18T06:00:00.000Z', now)).toBe('6h ago');
    expect(formatRelative('2026-08-15T12:00:00.000Z', now)).toBe('3d ago');
  });

  it('falls back to an absolute date beyond a month', () => {
    expect(formatRelative('2026-01-05T12:00:00.000Z', now)).toBe('05 Jan 2026');
  });

  it('handles missing and malformed input without throwing', () => {
    expect(formatRelative(null, now)).toBe('—');
    expect(formatRelative('not-a-date', now)).toBe('—');
  });
});

describe('normaliseRange', () => {
  // The API only implements these four windows; anything else silently
  // resolves to 1h server-side, so the UI must not offer or echo it.
  it('accepts every range the metrics endpoint actually implements', () => {
    for (const range of RANGES) {
      expect(normaliseRange(range)).toBe(range);
    }
  });

  it('falls back to 1h for unsupported or absent ranges', () => {
    expect(normaliseRange('30d')).toBe('1h');
    expect(normaliseRange('6h')).toBe('1h');
    expect(normaliseRange(undefined)).toBe('1h');
  });
});

describe('formatCount / formatPercent', () => {
  it('groups thousands so large counts stay scannable', () => {
    expect(formatCount(12_400)).toBe('12,400');
  });

  it('distinguishes a null percentage from zero', () => {
    expect(formatPercent(null)).toBeNull();
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(98.7)).toBe('98.7%');
  });

  it('rounds a raw float to one decimal, without a trailing zero', () => {
    // SFU nodes report memory as a raw float. Printing every digit makes
    // the fleet table unreadable and implies a precision nobody measured.
    expect(formatPercent(16.1159274436382)).toBe('16.1%');
    expect(formatPercent(13.06)).toBe('13.1%');
    expect(formatPercent(50)).toBe('50%');
    expect(formatPercent(49.98)).toBe('50%');
  });
});

describe('formatMs', () => {
  it('renders a value in milliseconds', () => {
    expect(formatMs(84)).toBe('84 ms');
    expect(formatMs(0)).toBe('0 ms');
  });

  // A connection with no stats sample yet is not the same as 0ms jitter;
  // that would read as a perfect connection instead of "unmeasured".
  it('distinguishes an unmeasured value from a real zero', () => {
    expect(formatMs(null)).toBeNull();
    expect(formatMs(undefined)).toBeNull();
  });
});

describe('formatBitrate', () => {
  it('renders sub-kilobit values in bits per second', () => {
    expect(formatBitrate(500)).toBe('500 bps');
  });

  it('renders kilobit-range values rounded to the nearest kbps', () => {
    expect(formatBitrate(64_000)).toBe('64 kbps');
    expect(formatBitrate(999_999)).toBe('1000 kbps');
  });

  it('switches to megabits at 1,000,000 bps with one decimal place', () => {
    expect(formatBitrate(1_000_000)).toBe('1.0 Mbps');
    expect(formatBitrate(2_500_000)).toBe('2.5 Mbps');
  });

  it('distinguishes an unmeasured value from a real zero', () => {
    expect(formatBitrate(null)).toBeNull();
    expect(formatBitrate(undefined)).toBeNull();
  });
});
