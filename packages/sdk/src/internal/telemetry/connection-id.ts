/**
 * Generated client-side, once per `join()` call, and never changed for
 * that connection's lifetime — this is the ID a developer sees in the
 * dashboard, in `raven connections inspect`, and in any error report
 * (Phase 9 spec §8). Prefers `crypto.randomUUID()` (available in every
 * SDK-supported browser); the manual fallback only matters for unusual
 * test/embedding environments.
 */
export function generateConnectionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `conn_${crypto.randomUUID().replace(/-/g, '')}`;
  }
  let id = '';
  for (let i = 0; i < 32; i++) {
    id += Math.floor(Math.random() * 16).toString(16);
  }
  return `conn_${id}`;
}
