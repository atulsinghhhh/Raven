// Shared by every k6 script here. TARGETS is a comma-separated list of
// base URLs — one per running `api` replica (see
// scripts/k6/discover-api-targets.sh) — so a single k6 run can spread
// load across a horizontally-scaled fleet instead of hammering one
// instance while N-1 others sit idle.

export function parseTargets(raw) {
  const targets = (raw || 'http://localhost:4100')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  if (targets.length === 0) {
    throw new Error('TARGETS resolved to zero entries — pass at least one base URL');
  }
  return targets;
}

/**
 * Deterministic per-VU assignment, not random per-iteration: what's
 * under test is whether aggregate load actually spreads across every
 * replica, which VU-modulo achieves without needing k6 to do its own
 * DNS-round-robin. __VU is 1-indexed.
 */
export function pickTarget(targets, vu) {
  return targets[(vu - 1) % targets.length];
}
