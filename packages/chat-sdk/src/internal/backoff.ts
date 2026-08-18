/**
 * Exponential backoff with full jitter, hard-capped.
 *
 * The cap and the attempt limit together are what keep this from being
 * an infinite reconnect loop (spec §11) — a client that can never
 * reconnect stops trying and reports `failed`, rather than hammering a
 * server that's already having a bad day.
 *
 * Jitter is not decoration. When a gateway restarts, every client it was
 * holding wakes up at the same instant; without jitter they'd all retry
 * in lockstep and re-create the thundering herd on each attempt. Full
 * jitter (a uniform pick in `[0, delay]`) spreads them out.
 */
export function backoffDelayMs(
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number,
  random: () => number = Math.random,
): number {
  const exponential = Math.min(initialDelayMs * Math.pow(2, Math.max(0, attempt - 1)), maxDelayMs);
  // Floored at a quarter of the target so a jittered delay can't collapse
  // to near-zero and burn an attempt instantly.
  const floor = exponential / 4;
  return Math.round(floor + random() * (exponential - floor));
}
