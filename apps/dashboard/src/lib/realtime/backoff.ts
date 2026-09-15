/**
 * Exponential backoff with full jitter, hard-capped. Ported from
 * packages/chat-sdk/src/internal/backoff.ts rather than reinvented: the
 * dashboard doesn't depend on @ravenkash/chat, so this is a copy, not an
 * import, but the algorithm and its reasoning are unchanged.
 *
 * The cap and the attempt limit together are what stop this being an
 * infinite reconnect loop. A client that can never reconnect gives up
 * and reports `failed` instead of hammering a server that's already
 * having a bad day.
 *
 * The jitter isn't decoration. When a gateway restarts, every client it was
 * holding wakes at the same instant, and without jitter they all retry in
 * lockstep and rebuild the thundering herd on every attempt. Full jitter,
 * a uniform pick in `[0, delay]`, spreads them out.
 */
export function backoffDelayMs(
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number,
  random: () => number = Math.random,
): number {
  const exponential = Math.min(initialDelayMs * Math.pow(2, Math.max(0, attempt - 1)), maxDelayMs);
  // Floored at a quarter of the target, so a jittered delay can't collapse
  // to near-zero and burn an attempt instantly.
  const floor = exponential / 4;
  return Math.round(floor + random() * (exponential - floor));
}
